import { Prisma, resetAdsProjection, type PrismaClient } from '@precommunity/database';

type AdsPositionDatabase = Pick<Prisma.TransactionClient, 'adStakePosition'>;
type AdsEventDatabase = Pick<Prisma.TransactionClient, 'adStakePosition' | 'adChainEvent'>;
type AdsProjectionClient = Pick<PrismaClient, '$transaction'>;

export interface AdPositionChange {
  chainId: number;
  contractAddress: string;
  keywordId: string;
  stakerAddress: string;
  stakeRaw: string;
  previousStakeRaw: string;
  bidUsdRaw: string;
  requiredCoveragePreRaw: string;
  eligible: boolean;
  withdrawAvailableAt: bigint;
  positionVersion: bigint;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
}

export interface AdsProjectionIdentity {
  chainId: number;
  contractAddress: string;
}

export interface AdsContractSnapshot {
  minimumStakeRaw: string;
  paused: boolean;
  operatorAddress: string;
  configBlockNumber: bigint;
}

function validAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function validKeywordId(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function eventAfter(
  blockNumber: bigint,
  logIndex: number,
  previousBlock: bigint,
  previousLogIndex: number,
) {
  return (
    blockNumber > previousBlock || (blockNumber === previousBlock && logIndex > previousLogIndex)
  );
}

/** Applies one normalized contract position event to the disposable ads projection. */
export async function applyAdPositionChange(
  database: AdsPositionDatabase,
  change: AdPositionChange,
) {
  if (!validAddress(change.contractAddress) || !validAddress(change.stakerAddress)) {
    throw new Error('PRE Keyword Market position event contains an invalid address');
  }
  if (!validKeywordId(change.keywordId)) {
    throw new Error('PRE Keyword Market position event contains an invalid keyword id');
  }
  let stake: bigint;
  let bidUsd: bigint;
  let requiredCoveragePre: bigint;
  let previousStake: bigint;
  try {
    stake = BigInt(change.stakeRaw);
    bidUsd = BigInt(change.bidUsdRaw);
    requiredCoveragePre = BigInt(change.requiredCoveragePreRaw);
    previousStake = BigInt(change.previousStakeRaw);
  } catch {
    throw new Error('PRE Keyword Market position event contains an invalid amount or bid');
  }
  if (
    stake < 0n ||
    bidUsd < 0n ||
    requiredCoveragePre < 0n ||
    previousStake < 0n ||
    change.withdrawAvailableAt < 0n ||
    change.positionVersion < 0n
  ) {
    throw new Error('PRE Keyword Market position event contains a negative value');
  }
  const identity = {
    chainId: change.chainId,
    contractAddress: change.contractAddress.toLowerCase(),
    keywordId: change.keywordId.toLowerCase(),
    stakerAddress: change.stakerAddress.toLowerCase(),
  };
  const current = await database.adStakePosition.findUnique({
    where: { chainId_contractAddress_keywordId_stakerAddress: identity },
  });
  if (
    current &&
    !eventAfter(
      change.blockNumber,
      change.logIndex,
      current.positionBlock,
      current.positionLogIndex,
    )
  ) {
    return { applied: false, reason: 'STALE_OR_DUPLICATE' as const };
  }
  const amountChanged = !current || current.stakeRaw !== stake.toString();
  const projection = {
    stakeRaw: stake.toString(),
    bidUsdRaw: bidUsd.toString(),
    requiredCoveragePreRaw: requiredCoveragePre.toString(),
    eligible: change.eligible,
    withdrawAvailableAt: change.withdrawAvailableAt,
    positionVersion: change.positionVersion,
    amountSinceBlock: amountChanged ? change.blockNumber : current.amountSinceBlock,
    amountSinceLogIndex: amountChanged ? change.logIndex : current.amountSinceLogIndex,
    positionBlock: change.blockNumber,
    positionBlockHash: change.blockHash.toLowerCase(),
    positionTxHash: change.txHash.toLowerCase(),
    positionLogIndex: change.logIndex,
    active: stake > 0n,
  };
  await database.adStakePosition.upsert({
    where: { chainId_contractAddress_keywordId_stakerAddress: identity },
    update: projection,
    create: { ...identity, ...projection },
  });
  return { applied: true, amountChanged };
}

/**
 * Claims a finalized chain log and projects it in the same transaction. Replays are harmless,
 * including after a worker retry following a process crash.
 */
export async function projectFinalizedAdPositionChange(
  database: AdsProjectionClient,
  change: AdPositionChange,
) {
  return database.$transaction((tx) => applyFinalizedAdPositionChange(tx, change), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

/** The indexer uses this inside the transaction that also commits its block checkpoint. */
export async function applyFinalizedAdPositionChange(
  database: AdsEventDatabase,
  change: AdPositionChange,
) {
  const event = await database.adChainEvent.createMany({
    data: [
      {
        chainId: change.chainId,
        contractAddress: change.contractAddress.toLowerCase(),
        txHash: change.txHash.toLowerCase(),
        logIndex: change.logIndex,
        blockNumber: change.blockNumber,
        blockHash: change.blockHash.toLowerCase(),
        eventName: 'PositionChanged',
        payload: {
          keywordId: change.keywordId.toLowerCase(),
          stakerAddress: change.stakerAddress.toLowerCase(),
          stakeRaw: change.stakeRaw,
          previousStakeRaw: change.previousStakeRaw,
          bidUsdRaw: change.bidUsdRaw,
          requiredCoveragePreRaw: change.requiredCoveragePreRaw,
          eligible: change.eligible,
          withdrawAvailableAt: change.withdrawAvailableAt.toString(),
          positionVersion: change.positionVersion.toString(),
        },
      },
    ],
    skipDuplicates: true,
  });
  if (event.count !== 1) return { applied: false, reason: 'DUPLICATE_EVENT' as const };
  return applyAdPositionChange(database, change);
}

export function finalizedAdsBlock(headBlock: bigint, confirmations: number) {
  if (!Number.isInteger(confirmations) || confirmations < 1) {
    throw new Error('PRE Keyword Market confirmations must be a positive integer');
  }
  const distance = BigInt(confirmations);
  return headBlock > distance ? headBlock - distance : 0n;
}

export function adsIndexerStateKey(identity: AdsProjectionIdentity) {
  return `${identity.chainId}:${identity.contractAddress.toLowerCase()}`;
}

export async function advanceAdsIndexerState(
  database: Pick<Prisma.TransactionClient, 'adIndexerState'>,
  identity: AdsProjectionIdentity,
  lastBlockNumber: bigint,
  lastBlockHash: string,
  snapshot?: AdsContractSnapshot,
) {
  const normalized = {
    chainId: identity.chainId,
    contractAddress: identity.contractAddress.toLowerCase(),
  };
  const current = await database.adIndexerState.findUnique({
    where: { key: adsIndexerStateKey(identity) },
  });
  if (current && current.lastBlockNumber > lastBlockNumber) return current;
  return database.adIndexerState.upsert({
    where: { key: adsIndexerStateKey(identity) },
    update: {
      ...normalized,
      ...snapshot,
      lastBlockNumber,
      lastBlockHash: lastBlockHash.toLowerCase(),
    },
    create: {
      key: adsIndexerStateKey(identity),
      ...normalized,
      ...snapshot,
      lastBlockNumber,
      lastBlockHash: lastBlockHash.toLowerCase(),
    },
  });
}

/** Reorg recovery removes only disposable ads chain data, never campaigns or moderation. */
export function resetAdsProjectionAfterReorg(
  database: AdsProjectionClient,
  identity: AdsProjectionIdentity,
) {
  return database.$transaction((tx) => resetAdsProjection(tx, identity), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}
