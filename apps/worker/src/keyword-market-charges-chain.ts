import type { AdChargeBatch, PrismaClient } from '@precommunity/database';
import { PRE_KEYWORD_MARKET_ABI } from '@precommunity/shared';
import { Wallet } from 'ethers';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BaseError,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  InsufficientFundsError,
  keccak256,
  TransactionReceiptNotFoundError,
  type Hex,
  type PrivateKeyAccount,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { estimateTotalFee } from 'viem/op-stack';
import { config } from './config';
import { verifyKeywordMarketReadiness } from './keyword-market-readiness';

export class ChargeBlocked extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function insufficientFunds(error: unknown) {
  return (
    error instanceof BaseError &&
    Boolean(error.walk((cause) => cause instanceof InsufficientFundsError))
  );
}

export interface ChargeReceipt {
  transactionHash?: string;
  blockNumber: bigint;
  blockHash: string;
  reverted: boolean;
  event: {
    chargeId: string;
    keywordId: string;
    staker: string;
    requestedPre: bigint;
    chargedPre: bigint;
  } | null;
}

export interface ChargeChain {
  head(): Promise<bigint>;
  blockHash(block: bigint): Promise<string>;
  verify(database: PrismaClient): Promise<void>;
  operator(): Promise<string>;
  balance(address: string): Promise<bigint>;
  position(
    batch: AdChargeBatch,
    block?: bigint,
  ): Promise<{ amount: bigint; positionVersion: bigint }>;
  processed(chargeId: string): Promise<boolean>;
  receipt(hash: string, chargeId: string): Promise<ChargeReceipt | null>;
  pendingNonce(address: string): Promise<bigint>;
  sign(
    batch: AdChargeBatch,
    account: PrivateKeyAccount,
    nonce: bigint,
  ): Promise<{ raw: Hex; hash: Hex }>;
  broadcast(raw: string): Promise<string>;
}

export async function unlockChargeOperator(path: string | null, password: string | undefined) {
  if (!path) throw new ChargeBlocked('KEYSTORE_MISSING');
  if (password === undefined) throw new ChargeBlocked('KEYSTORE_INVALID');
  const filename = resolve(__dirname, '../../../', path);
  let encrypted: string;
  try {
    if ((await stat(filename)).size > 1_048_576) throw new Error('Oversized keystore');
    encrypted = await readFile(filename, 'utf8');
  } catch {
    throw new ChargeBlocked('KEYSTORE_MISSING');
  }
  try {
    // Password whitespace is meaningful for Ethereum keystores.
    const wallet = await Wallet.fromEncryptedJson(encrypted, password);
    return privateKeyToAccount(wallet.privateKey as Hex);
  } catch {
    throw new ChargeBlocked('KEYSTORE_INVALID');
  }
}

export function createChargeChain(): ChargeChain {
  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.BASE_RPC_URL, { timeout: 5_000, retryCount: 0 }),
  });
  const address = config.adsContract.address as Hex;
  const blockHashes = new Map<bigint, string>();
  return {
    head: async () => {
      if ((await client.getChainId()) !== config.deployment.chainId)
        throw new ChargeBlocked('CHAIN_MISMATCH');
      return client.getBlockNumber({ cacheTime: 0 });
    },
    blockHash: async (blockNumber) => {
      const saved = blockHashes.get(blockNumber);
      if (saved) return saved;
      const hash = String((await client.getBlock({ blockNumber })).hash).toLowerCase();
      blockHashes.set(blockNumber, hash);
      return hash;
    },
    verify: async (database) => {
      try {
        await verifyKeywordMarketReadiness(client, database, {
          chainId: config.deployment.chainId,
          contractAddress: config.adsContract.address,
          deploymentBlock: config.adsContract.deploymentBlock,
          preAddress: config.deployment.preAddress,
          safeAddress: config.SAFE_ADDRESS ?? config.deployment.owner,
          confirmations: config.deployment.confirmations,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/projection|checkpoint|synchronized|reorganized/.test(message))
          throw new ChargeBlocked('INDEXER_UNAVAILABLE');
        if (/chain does not match/.test(message)) throw new ChargeBlocked('CHAIN_MISMATCH');
        if (/runtime|identity|decimals|owner|artifact|ABI|deployment|exists before/.test(message))
          throw new ChargeBlocked('CONTRACT_MISMATCH');
        throw new ChargeBlocked('RPC_UNAVAILABLE');
      }
    },
    operator: async () =>
      getAddress(
        await client.readContract({
          address,
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: 'operator',
        }),
      ).toLowerCase(),
    balance: (account) => client.getBalance({ address: account as Hex }),
    position: async (batch, blockNumber) => {
      const position = await client.readContract({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'stakeDetailsOf',
        args: [batch.keywordId as Hex, batch.stakerAddress as Hex],
        blockNumber,
      });
      return { amount: position[0], positionVersion: position[5] };
    },
    processed: (chargeId) =>
      client.readContract({
        address,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'chargeProcessed',
        args: [chargeId as Hex],
      }),
    receipt: async (hash, chargeId) => {
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: hash as Hex });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
      let event: ChargeReceipt['event'] = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== address) continue;
        try {
          const decoded = decodeEventLog({
            abi: PRE_KEYWORD_MARKET_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (
            decoded.eventName === 'StakeCharged' &&
            decoded.args.chargeId.toLowerCase() === chargeId.toLowerCase()
          ) {
            event = decoded.args;
          }
        } catch {
          // Other contracts and unrelated log shapes cannot acknowledge this charge.
        }
      }
      return {
        transactionHash: receipt.transactionHash ?? hash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash.toLowerCase(),
        reverted: receipt.status === 'reverted',
        event,
      };
    },
    pendingNonce: async (account) =>
      BigInt(await client.getTransactionCount({ address: account as Hex, blockTag: 'pending' })),
    sign: async (batch, account, nonce) => {
      const args = [
        batch.keywordId as Hex,
        batch.stakerAddress as Hex,
        batch.positionVersion,
        BigInt(batch.requestedPreRaw),
        batch.chargeId as Hex,
      ] as const;
      try {
        await client.simulateContract({
          account,
          address,
          abi: PRE_KEYWORD_MARKET_ABI,
          functionName: 'chargeStake',
          args,
        });
        const request = await client.prepareTransactionRequest({
          account,
          to: address,
          data: encodeFunctionData({
            abi: PRE_KEYWORD_MARKET_ABI,
            functionName: 'chargeStake',
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
        const fee = totalFee > l2Cap ? totalFee : l2Cap;
        if ((await client.getBalance({ address: account.address })) < fee)
          throw new ChargeBlocked('INSUFFICIENT_GAS');
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
        if (error instanceof ChargeBlocked) throw error;
        if (insufficientFunds(error)) throw new ChargeBlocked('INSUFFICIENT_GAS');
        // Upstream errors can include the RPC URL, transaction bytes or credentials.
        throw new ChargeBlocked('TRANSACTION_FAILED');
      }
    },
    broadcast: async (serializedTransaction) => {
      try {
        return await client.sendRawTransaction({
          serializedTransaction: serializedTransaction as Hex,
        });
      } catch (error) {
        if (insufficientFunds(error)) throw new ChargeBlocked('INSUFFICIENT_GAS');
        throw error;
      }
    },
  };
}
