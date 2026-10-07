import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PRE_KEYWORD_MARKET_ABI, adKeywordId, type AdsChainStatus } from '@precommunity/shared';
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http } from 'viem';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';

export const ADS_CHAIN_ADAPTER = Symbol('ADS_CHAIN_ADAPTER');

const MAX_UINT256 = (1n << 256n) - 1n;

export interface AdsChainSnapshot {
  status: AdsChainStatus;
  chainId: number;
  contractAddress: string | null;
  deploymentBlock: string | null;
  transactionsEnabled: boolean;
  indexedThroughBlock: string | null;
  minimumStakeRaw: string | null;
  preTokenAddress: string;
  paused: boolean | null;
}

export interface AdsChainPositionQuery {
  canonicalKeyword: string;
  stakerAddress: string;
}

export interface AdsChainPositionState extends AdsChainPositionQuery {
  stakeRaw: string;
  bidUsdRaw: string;
  requiredCoveragePreRaw: string;
  eligible: boolean;
  withdrawAvailableAt: string;
  positionVersion: string;
  active: boolean;
}

export type AdsStakeOperation = 'STAKE' | 'REQUEST_UNSTAKE' | 'UNSTAKE';

export interface AdsStakeOperationInput extends AdsChainPositionQuery {
  amountRaw?: string;
  bidUsdRaw?: string;
}

export interface AdsPreparedTransaction {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  valueRaw: string;
}

export interface AdsDisabledStakeTransactionPlan {
  status: Exclude<AdsChainStatus, 'SYNCED'>;
  operation: AdsStakeOperation;
  enabled: false;
  transaction: null;
}

export interface AdsReadyStakeTransactionPlan {
  status: 'READY';
  operation: AdsStakeOperation;
  enabled: true;
  keywordId: `0x${string}`;
  tokenAddress: `0x${string}`;
  approvalTransaction: AdsPreparedTransaction | null;
  transaction: AdsPreparedTransaction;
}

export type AdsStakeTransactionPlan =
  AdsDisabledStakeTransactionPlan | AdsReadyStakeTransactionPlan;

export interface AdsChainAdapter {
  snapshot(): Promise<AdsChainSnapshot>;
  position(query: AdsChainPositionQuery): Promise<AdsChainPositionState | null>;
  stake(input: AdsStakeOperationInput): Promise<AdsStakeTransactionPlan>;
  requestUnstake(input: AdsStakeOperationInput): Promise<AdsStakeTransactionPlan>;
  unstake(input: AdsStakeOperationInput): Promise<AdsStakeTransactionPlan>;
}

export function parseAdsStakeAmount(value?: string) {
  if (!value || !/^(?:0|[1-9]\d*)$/.test(value) || BigInt(value) > MAX_UINT256) {
    throw new BadRequestException('Stake amount must be a non-negative integer in raw PRE units');
  }
  return value;
}

export function parseAdsBidUsd(value?: string) {
  if (!value || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_UINT256) {
    throw new BadRequestException('Bid must be a positive integer in micro USD');
  }
  return value;
}

export function buildAdsStakeTransactionPlan(input: {
  operation: AdsStakeOperation;
  chainId: number;
  contractAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  keywordId: `0x${string}`;
  amountRaw?: string;
  bidUsdRaw?: string;
  approvalRequired: boolean;
}): AdsReadyStakeTransactionPlan {
  const amount = input.amountRaw ? BigInt(input.amountRaw) : 0n;
  const transactionData =
    input.operation === 'STAKE'
      ? encodeFunctionData({
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: 'stake',
          args: [input.keywordId, amount, BigInt(input.bidUsdRaw!)],
        })
      : encodeFunctionData({
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: input.operation === 'REQUEST_UNSTAKE' ? 'requestUnstake' : 'unstake',
          args: [input.keywordId],
        });
  return {
    status: 'READY',
    operation: input.operation,
    enabled: true,
    keywordId: input.keywordId,
    tokenAddress: input.tokenAddress,
    approvalTransaction:
      amount > 0n && input.approvalRequired
        ? {
            chainId: input.chainId,
            to: input.tokenAddress,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [input.contractAddress, amount],
            }),
            valueRaw: '0',
          }
        : null,
    transaction: {
      chainId: input.chainId,
      to: input.contractAddress,
      data: transactionData,
      valueRaw: '0',
    },
  };
}

const client = createPublicClient({ chain: config.chain, transport: http(config.BASE_RPC_URL) });

@Injectable()
export class ContractAdsChainAdapter implements AdsChainAdapter {
  private readonly publicClient = client;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async snapshot(): Promise<AdsChainSnapshot> {
    const preTokenAddress = getAddress(config.deployment.preAddress);
    if (!config.adsContract.address || !config.adsContract.deploymentBlock) {
      return {
        status: 'AWAITING_CONTRACT',
        chainId: config.deployment.chainId,
        contractAddress: null,
        deploymentBlock: null,
        transactionsEnabled: false,
        indexedThroughBlock: null,
        minimumStakeRaw: null,
        preTokenAddress,
        paused: null,
      };
    }
    const contractAddress = getAddress(config.adsContract.address).toLowerCase();
    const state = await this.prisma.adIndexerState.findUnique({
      where: { key: `${config.deployment.chainId}:${contractAddress}` },
    });
    const synced = Boolean(
      state &&
      Date.now() - state.updatedAt.getTime() <= 60_000 &&
      state.configBlockNumber === state.lastBlockNumber &&
      state.minimumStakeRaw !== null &&
      state.paused !== null &&
      state.operatorAddress !== null,
    );
    return {
      status: synced ? 'SYNCED' : 'SYNCING',
      chainId: config.deployment.chainId,
      contractAddress,
      deploymentBlock: config.adsContract.deploymentBlock,
      transactionsEnabled: synced && state?.paused === false,
      indexedThroughBlock: state?.lastBlockNumber.toString() ?? null,
      minimumStakeRaw: state?.minimumStakeRaw ?? null,
      preTokenAddress,
      paused: state?.paused ?? null,
    };
  }

  async position(query: AdsChainPositionQuery): Promise<AdsChainPositionState | null> {
    if (!config.adsContract.address) return null;
    const position = await this.prisma.adStakePosition.findUnique({
      where: {
        chainId_contractAddress_keywordId_stakerAddress: {
          chainId: config.deployment.chainId,
          contractAddress: getAddress(config.adsContract.address).toLowerCase(),
          keywordId: adKeywordId(query.canonicalKeyword),
          stakerAddress: getAddress(query.stakerAddress).toLowerCase(),
        },
      },
    });
    if (!position) return null;
    return {
      ...query,
      stakeRaw: position.stakeRaw,
      bidUsdRaw: position.bidUsdRaw,
      requiredCoveragePreRaw: position.requiredCoveragePreRaw,
      eligible: position.eligible,
      withdrawAvailableAt: position.withdrawAvailableAt.toString(),
      positionVersion: position.positionVersion.toString(),
      active: position.active,
    };
  }

  stake(input: AdsStakeOperationInput) {
    return this.prepare('STAKE', input);
  }

  requestUnstake(input: AdsStakeOperationInput) {
    return this.prepare('REQUEST_UNSTAKE', input);
  }

  unstake(input: AdsStakeOperationInput) {
    return this.prepare('UNSTAKE', input);
  }

  private async prepare(
    operation: AdsStakeOperation,
    input: AdsStakeOperationInput,
  ): Promise<AdsStakeTransactionPlan> {
    const snapshot = await this.snapshot();
    if (!snapshot.contractAddress) {
      return { status: 'AWAITING_CONTRACT', operation, enabled: false, transaction: null };
    }
    if (operation === 'STAKE' && snapshot.status !== 'SYNCED') {
      return { status: 'SYNCING', operation, enabled: false, transaction: null };
    }
    const amountRaw = operation === 'STAKE' ? parseAdsStakeAmount(input.amountRaw) : undefined;
    const bidUsdRaw = operation === 'STAKE' ? parseAdsBidUsd(input.bidUsdRaw) : undefined;
    // Live reads are limited to a wallet action. Ordinary status/position views use Prisma.
    const contractAddress = getAddress(snapshot.contractAddress);
    const tokenAddress = getAddress(config.deployment.preAddress);
    const keywordId = adKeywordId(input.canonicalKeyword);
    const [amount, , , , withdrawAvailableAt] = await this.publicClient.readContract({
      address: contractAddress,
      abi: PRE_KEYWORD_MARKET_ABI,
      functionName: 'stakeDetailsOf',
      args: [keywordId, getAddress(input.stakerAddress)],
    });
    const current = { active: amount > 0n, withdrawAvailableAt: String(withdrawAvailableAt) };
    if (operation === 'STAKE') {
      const [minimumStake, paused] = await Promise.all([
        this.publicClient.readContract({
          address: contractAddress,
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: 'minimumStake',
        }),
        this.publicClient.readContract({
          address: contractAddress,
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: 'paused',
        }),
      ]);
      if (paused) throw new ServiceUnavailableException('Keyword Market staking is paused');
      if (current.active && current.withdrawAvailableAt !== '0') {
        throw new BadRequestException('This position is awaiting withdrawal');
      }
      if (amountRaw === '0' && !current.active) {
        throw new BadRequestException('A new position requires a PRE deposit');
      }
      if (!current.active && BigInt(amountRaw!) < minimumStake) {
        throw new BadRequestException(
          `A new position requires at least ${minimumStake} raw PRE units`,
        );
      }
    } else if (!current.active) {
      throw new BadRequestException('This wallet has no PRE stake for the keyword');
    } else if (operation === 'REQUEST_UNSTAKE' && current.withdrawAvailableAt !== '0') {
      throw new BadRequestException('Unstake was already requested');
    } else if (operation === 'UNSTAKE') {
      if (current.withdrawAvailableAt === '0') {
        throw new BadRequestException('Request unstake before withdrawing PRE');
      }
      if (BigInt(current.withdrawAvailableAt) > BigInt(Math.floor(Date.now() / 1000))) {
        throw new BadRequestException('The 24-hour unstake period has not ended');
      }
    }

    const allowance =
      operation === 'STAKE' && BigInt(amountRaw!) > 0n
        ? await this.publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [getAddress(input.stakerAddress), contractAddress],
          })
        : 0n;
    return buildAdsStakeTransactionPlan({
      operation,
      chainId: snapshot.chainId,
      contractAddress,
      tokenAddress,
      keywordId,
      amountRaw,
      bidUsdRaw,
      approvalRequired: operation === 'STAKE' && allowance < BigInt(amountRaw!),
    });
  }
}
