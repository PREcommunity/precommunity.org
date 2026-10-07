import { Prisma, type PrismaClient } from '@precommunity/database';
import { PRE_KEYWORD_MARKET_ABI } from '@precommunity/shared';
import { createPublicClient, getAddress, http } from 'viem';
import { config, INDEXER_LOG_BLOCK_RANGE } from './config';
import {
  adsIndexerStateKey,
  advanceAdsIndexerState,
  applyFinalizedAdPositionChange,
  finalizedAdsBlock,
  resetAdsProjectionAfterReorg,
  type AdsContractSnapshot,
} from './ads-projection';

export interface AdsChainSourceStatus {
  status: 'AWAITING_CONTRACT' | 'SYNCING' | 'SYNCED';
  chainId: number;
  contractAddress: string | null;
  deploymentBlock: string | null;
}

type AdsCheckpoint = { lastBlockNumber: bigint; lastBlockHash: string };

async function assertUnchangedCheckpoint(
  database: Pick<Prisma.TransactionClient, 'adIndexerState'>,
  key: string,
  expected: AdsCheckpoint | null,
) {
  const current = await database.adIndexerState.findUnique({ where: { key } });
  if (
    Boolean(current) !== Boolean(expected) ||
    (current &&
      expected &&
      (current.lastBlockNumber !== expected.lastBlockNumber ||
        current.lastBlockHash.toLowerCase() !== expected.lastBlockHash.toLowerCase()))
  ) {
    throw new Error('Keyword Market checkpoint changed during indexing; retry');
  }
}

const publicClient = createPublicClient({
  chain: config.chain,
  transport: http(config.BASE_RPC_URL),
});

export class ContractAdsChainSource {
  private verifiedAddress: string | null = null;

  constructor(private readonly client = publicClient) {}

  status(status: AdsChainSourceStatus['status'] = 'SYNCING'): AdsChainSourceStatus {
    return {
      status: config.adsContract.address ? status : 'AWAITING_CONTRACT',
      chainId: config.deployment.chainId,
      contractAddress: config.adsContract.address,
      deploymentBlock: config.adsContract.deploymentBlock,
    };
  }

  private async verify(address: `0x${string}`, deploymentBlock: bigint) {
    if (this.verifiedAddress === address.toLowerCase()) return;
    const [chainId, bytecode, pre, owner, minimumStake] = await Promise.all([
      this.client.getChainId(),
      this.client.getBytecode({ address, blockNumber: deploymentBlock }),
      this.client.readContract({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'PRE',
        blockNumber: deploymentBlock,
      }),
      this.client.readContract({ address, abi: PRE_KEYWORD_MARKET_ABI, functionName: 'owner' }),
      this.client.readContract({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'minimumStake',
      }),
    ]);
    if (chainId !== config.deployment.chainId) {
      throw new Error(
        `Keyword Market chain mismatch: expected ${config.deployment.chainId}, got ${chainId}`,
      );
    }
    if (!bytecode || bytecode === '0x') {
      throw new Error('Keyword Market bytecode is missing at its configured deployment block');
    }
    if (getAddress(String(pre)) !== getAddress(config.deployment.preAddress)) {
      throw new Error('Keyword Market PRE token does not match the selected deployment');
    }
    const expectedOwner = config.SAFE_ADDRESS ?? config.deployment.owner;
    if (getAddress(String(owner)) !== getAddress(expectedOwner)) {
      throw new Error('Keyword Market owner does not match the configured Safe');
    }
    if (BigInt(String(minimumStake)) <= 0n) {
      throw new Error('Keyword Market minimum stake must be positive');
    }
    this.verifiedAddress = address.toLowerCase();
  }

  private async contractSnapshot(
    address: `0x${string}`,
    blockNumber: bigint,
  ): Promise<AdsContractSnapshot> {
    const [pre, minimumStake, paused, operator] = await Promise.all([
      this.client.readContract({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'PRE',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'minimumStake',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'paused',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'operator',
        blockNumber,
      }),
    ]);
    if (getAddress(String(pre)) !== getAddress(config.deployment.preAddress)) {
      throw new Error('Keyword Market PRE token does not match the selected deployment');
    }
    if (minimumStake <= 0n) throw new Error('Keyword Market minimum stake must be positive');
    return {
      minimumStakeRaw: minimumStake.toString(),
      paused,
      operatorAddress: getAddress(operator).toLowerCase(),
      configBlockNumber: blockNumber,
    };
  }

  private async assertCanonicalCheckpoint(checkpoint: AdsCheckpoint | null) {
    if (!checkpoint) return;
    const canonical = await this.client.getBlock({ blockNumber: checkpoint.lastBlockNumber });
    if (canonical.hash.toLowerCase() !== checkpoint.lastBlockHash.toLowerCase()) {
      throw new Error('Keyword Market chain reorganized across indexed chunks');
    }
  }

  async index(prisma: PrismaClient) {
    if (!config.adsContract.address || !config.adsContract.deploymentBlock) {
      return { processed: 0, ...this.status('AWAITING_CONTRACT') };
    }

    const address = getAddress(config.adsContract.address);
    const deploymentBlock = BigInt(config.adsContract.deploymentBlock);
    const identity = { chainId: config.deployment.chainId, contractAddress: address.toLowerCase() };
    await this.verify(address, deploymentBlock);

    const head = await this.client.getBlockNumber();
    const safeHead = finalizedAdsBlock(head, config.deployment.confirmations);
    if (safeHead < deploymentBlock) {
      return { processed: 0, ...this.status('SYNCING'), head: head.toString() };
    }

    const key = adsIndexerStateKey(identity);
    let state = await prisma.adIndexerState.findUnique({ where: { key } });
    let fromBlock = state ? state.lastBlockNumber + 1n : deploymentBlock;
    if (state) {
      const canonical = await this.client.getBlock({ blockNumber: state.lastBlockNumber });
      if (canonical.hash.toLowerCase() !== state.lastBlockHash.toLowerCase()) {
        await resetAdsProjectionAfterReorg(prisma, identity);
        state = null;
        fromBlock = deploymentBlock;
      }
    }

    if (state && state.lastBlockNumber > safeHead) {
      return { processed: 0, ...this.status('SYNCING'), head: head.toString() };
    }

    if (fromBlock > safeHead) {
      if (state) {
        const snapshot = await this.contractSnapshot(address, safeHead);
        const canonical = await this.client.getBlock({ blockNumber: state.lastBlockNumber });
        if (canonical.hash.toLowerCase() !== state.lastBlockHash.toLowerCase()) {
          throw new Error('Keyword Market chain reorganized while reading contract configuration');
        }
        await prisma.$transaction(
          async (tx) => {
            await assertUnchangedCheckpoint(tx, key, state);
            return advanceAdsIndexerState(
              tx,
              identity,
              state!.lastBlockNumber,
              state!.lastBlockHash,
              snapshot,
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      }
      return {
        processed: 0,
        ...this.status('SYNCED'),
        indexedThroughBlock: state?.lastBlockNumber.toString() ?? null,
      };
    }

    let processed = 0;
    let checkpoint: AdsCheckpoint | null = state;
    for (let start = fromBlock; start <= safeHead; start += INDEXER_LOG_BLOCK_RANGE) {
      const end =
        start + INDEXER_LOG_BLOCK_RANGE - 1n > safeHead
          ? safeHead
          : start + INDEXER_LOG_BLOCK_RANGE - 1n;
      await this.assertCanonicalCheckpoint(checkpoint);
      const indexedBlock = await this.client.getBlock({ blockNumber: end });
      const logs = await this.client.getContractEvents({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        eventName: 'PositionChanged',
        fromBlock: start,
        toBlock: end,
        strict: true,
      });
      logs.sort((left, right) =>
        left.blockNumber === right.blockNumber
          ? left.logIndex - right.logIndex
          : left.blockNumber < right.blockNumber
            ? -1
            : 1,
      );
      const snapshot = end === safeHead ? await this.contractSnapshot(address, end) : undefined;
      const canonical = await this.client.getBlock({ blockNumber: end });
      if (canonical.hash.toLowerCase() !== indexedBlock.hash.toLowerCase()) {
        throw new Error('Keyword Market chain reorganized while reading position events');
      }
      await this.assertCanonicalCheckpoint(checkpoint);
      const applied = await prisma.$transaction(
        async (tx) => {
          await assertUnchangedCheckpoint(tx, key, checkpoint);
          let count = 0;
          for (const log of logs) {
            const args = log.args as {
              keywordId: `0x${string}`;
              staker: `0x${string}`;
              newStake: bigint;
              previousStake: bigint;
              bidUsd: bigint;
              requiredCoveragePre: bigint;
              eligible: boolean;
              withdrawAvailableAt: bigint;
              positionVersion: bigint;
            };
            const result = await applyFinalizedAdPositionChange(tx, {
              ...identity,
              keywordId: args.keywordId,
              stakerAddress: args.staker,
              stakeRaw: args.newStake.toString(),
              previousStakeRaw: args.previousStake.toString(),
              bidUsdRaw: args.bidUsd.toString(),
              requiredCoveragePreRaw: args.requiredCoveragePre.toString(),
              eligible: args.eligible,
              withdrawAvailableAt: args.withdrawAvailableAt,
              positionVersion: args.positionVersion,
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              txHash: log.transactionHash,
              logIndex: log.logIndex,
            });
            if (result.applied) count += 1;
          }
          await advanceAdsIndexerState(tx, identity, end, indexedBlock.hash, snapshot);
          return count;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
      );
      checkpoint = { lastBlockNumber: end, lastBlockHash: indexedBlock.hash };
      processed += applied;
    }

    return {
      processed,
      ...this.status('SYNCED'),
      indexedThroughBlock: safeHead.toString(),
    };
  }
}

export const adsChainSource = new ContractAdsChainSource();

export function indexAds(prisma: PrismaClient) {
  return adsChainSource.index(prisma);
}
