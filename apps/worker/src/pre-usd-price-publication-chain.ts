import type { AdPricePublication } from '@precommunity/database';
import { PRE_KEYWORD_MARKET_ABI } from '@precommunity/shared';
import {
  BaseError,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  InsufficientFundsError,
  keccak256,
  TransactionReceiptNotFoundError,
  type Hex,
  type PrivateKeyAccount,
} from 'viem';
import { estimateTotalFee } from 'viem/op-stack';
import { config } from './config';
import { unlockChargeOperator } from './keyword-market-charges-chain';
import { loadReviewedMarketArtifact, normalizedMarketRuntime } from './keyword-market-readiness';

export class PricePublicationBlocked extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface ContractPreUsdPrice {
  priceE18: bigint;
  quotedAt: bigint;
}

export interface PricePublicationReceipt {
  blockNumber: bigint;
  blockHash: string;
  reverted: boolean;
  event: ContractPreUsdPrice | null;
}

export interface PricePublicationChain {
  head(): Promise<bigint>;
  blockHash(block: bigint): Promise<string>;
  verify(): Promise<void>;
  price(block?: bigint): Promise<ContractPreUsdPrice>;
  authorities(): Promise<{ updater: string; operator: string }>;
  receipt(hash: string): Promise<PricePublicationReceipt | null>;
  nonce(address: string, pending: boolean): Promise<bigint>;
  sign(
    publication: AdPricePublication,
    account: PrivateKeyAccount,
    nonce: bigint,
  ): Promise<{ raw: Hex; hash: Hex }>;
  broadcast(raw: string): Promise<string>;
}

export async function unlockPriceUpdater(path: string | null, password: string | undefined) {
  try {
    return await unlockChargeOperator(path, password);
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? String(error.code) : 'KEYSTORE_INVALID';
    throw new PricePublicationBlocked(code === 'KEYSTORE_MISSING' ? code : 'KEYSTORE_INVALID');
  }
}

function insufficientFunds(error: unknown) {
  return (
    error instanceof BaseError &&
    Boolean(error.walk((cause) => cause instanceof InsufficientFundsError))
  );
}

export function createPricePublicationChain(): PricePublicationChain {
  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.BASE_RPC_URL, { timeout: 5_000, retryCount: 0 }),
  });
  const address = config.adsContract.address as Hex;
  return {
    head: async () => {
      if ((await client.getChainId()) !== config.deployment.chainId)
        throw new PricePublicationBlocked('CHAIN_MISMATCH');
      return client.getBlockNumber({ cacheTime: 0 });
    },
    blockHash: async (blockNumber) =>
      String((await client.getBlock({ blockNumber })).hash).toLowerCase(),
    verify: async () => {
      try {
        const deploymentBlock = BigInt(config.adsContract.deploymentBlock ?? '0');
        if (deploymentBlock <= 0n) throw new PricePublicationBlocked('CONTRACT_MISMATCH');
        const { artifact } = loadReviewedMarketArtifact();
        if (
          artifact.contractName !== 'PREKeywordMarketV1' ||
          !artifact.buildInfoId ||
          JSON.stringify(artifact.abi) !== JSON.stringify(PRE_KEYWORD_MARKET_ABI)
        ) {
          throw new PricePublicationBlocked('CONTRACT_MISMATCH');
        }
        const [code, initialCode, priorCode, pre, owner, decimals, tokenCode, safeCode] =
          await Promise.all([
            client.getBytecode({ address }),
            client.getBytecode({ address, blockNumber: deploymentBlock }),
            client.getBytecode({ address, blockNumber: deploymentBlock - 1n }),
            client.readContract({ address, abi: PRE_KEYWORD_MARKET_ABI, functionName: 'PRE' }),
            client.readContract({ address, abi: PRE_KEYWORD_MARKET_ABI, functionName: 'owner' }),
            client.readContract({
              address: config.deployment.preAddress as Hex,
              abi: erc20Abi,
              functionName: 'decimals',
            }),
            client.getBytecode({ address: config.deployment.preAddress as Hex }),
            client.getBytecode({
              address: (config.SAFE_ADDRESS ?? config.deployment.owner) as Hex,
            }),
          ]);
        const expected = normalizedMarketRuntime(artifact.deployedBytecode, artifact);
        if (
          normalizedMarketRuntime(code ?? '', artifact) !== expected ||
          normalizedMarketRuntime(initialCode ?? '', artifact) !== expected ||
          (priorCode && priorCode !== '0x') ||
          getAddress(pre) !== getAddress(config.deployment.preAddress) ||
          getAddress(owner) !== getAddress(config.SAFE_ADDRESS ?? config.deployment.owner) ||
          decimals !== 18 ||
          !tokenCode ||
          tokenCode === '0x' ||
          !safeCode ||
          safeCode === '0x'
        )
          throw new PricePublicationBlocked('CONTRACT_MISMATCH');
      } catch (error) {
        if (error instanceof PricePublicationBlocked) throw error;
        if (error instanceof Error && /runtime|immutable|artifact|ABI/.test(error.message))
          throw new PricePublicationBlocked('CONTRACT_MISMATCH');
        throw new PricePublicationBlocked('RPC_UNAVAILABLE');
      }
    },
    price: async (blockNumber) => {
      blockNumber ??= await client.getBlockNumber({ cacheTime: 0 });
      const [priceE18, quotedAt] = await Promise.all([
        client.readContract({
          address,
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: 'preUsdPriceE18',
          blockNumber,
        }),
        client.readContract({
          address,
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: 'preUsdPriceQuotedAt',
          blockNumber,
        }),
      ]);
      return { priceE18, quotedAt };
    },
    authorities: async () => {
      const [updater, operator] = await Promise.all([
        client.readContract({ address, abi: PRE_KEYWORD_MARKET_ABI, functionName: 'priceUpdater' }),
        client.readContract({ address, abi: PRE_KEYWORD_MARKET_ABI, functionName: 'operator' }),
      ]);
      return {
        updater: getAddress(updater).toLowerCase(),
        operator: getAddress(operator).toLowerCase(),
      };
    },
    receipt: async (hash) => {
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: hash as Hex });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw new PricePublicationBlocked('RPC_UNAVAILABLE');
      }
      let event: ContractPreUsdPrice | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== address.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: PRE_KEYWORD_MARKET_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'PreUsdPriceUpdated')
            event = { priceE18: decoded.args.priceE18, quotedAt: decoded.args.quotedAt };
        } catch {
          // Unrelated logs cannot acknowledge a price publication.
        }
      }
      return {
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash.toLowerCase(),
        reverted: receipt.status === 'reverted',
        event,
      };
    },
    nonce: async (account, pending) =>
      BigInt(
        await client.getTransactionCount({
          address: account as Hex,
          blockTag: pending ? 'pending' : 'latest',
        }),
      ),
    sign: async (publication, account, nonce) => {
      if (nonce < 0n || nonce > BigInt(Number.MAX_SAFE_INTEGER))
        throw new PricePublicationBlocked('NONCE_GAP');
      const args = [BigInt(publication.priceE18Raw), publication.quotedAt] as const;
      try {
        await client.simulateContract({
          account,
          address,
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: 'updatePreUsdPrice',
          args,
        });
        const request = await client.prepareTransactionRequest({
          account,
          to: address,
          data: encodeFunctionData({
            abi: PRE_KEYWORD_MARKET_ABI,
            functionName: 'updatePreUsdPrice',
            args,
          }),
          nonce: Number(nonce),
          type: 'eip1559',
        });
        const l2Cap = request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
        const totalFee = await estimateTotalFee(client, {
          account,
          to: address,
          type: 'eip1559',
          data: request.data,
          nonce: request.nonce,
          gas: request.gas,
          maxFeePerGas: request.maxFeePerGas,
          maxPriorityFeePerGas: request.maxPriorityFeePerGas,
        });
        if (
          (await client.getBalance({ address: account.address })) <
          (totalFee > l2Cap ? totalFee : l2Cap)
        )
          throw new PricePublicationBlocked('INSUFFICIENT_GAS');
        const raw = await account.signTransaction({
          type: 'eip1559',
          chainId: config.deployment.chainId,
          to: address,
          data: request.data,
          nonce: request.nonce,
          gas: request.gas,
          maxFeePerGas: request.maxFeePerGas,
          maxPriorityFeePerGas: request.maxPriorityFeePerGas,
        });
        return { raw, hash: keccak256(raw) };
      } catch (error) {
        if (error instanceof PricePublicationBlocked) throw error;
        throw new PricePublicationBlocked(
          insufficientFunds(error) ? 'INSUFFICIENT_GAS' : 'TRANSACTION_FAILED',
        );
      }
    },
    broadcast: async (serializedTransaction) => {
      try {
        return await client.sendRawTransaction({
          serializedTransaction: serializedTransaction as Hex,
        });
      } catch (error) {
        throw new PricePublicationBlocked(
          insufficientFunds(error) ? 'INSUFFICIENT_GAS' : 'TRANSACTION_UNKNOWN',
        );
      }
    },
  };
}
