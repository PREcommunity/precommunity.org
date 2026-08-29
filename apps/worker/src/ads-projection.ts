import { Prisma, resetAdsProjection, type PrismaClient } from '@precommunity/database';
import { normalizeAdKeyword } from '@precommunity/shared';

type AdsPositionDatabase = Pick<Prisma.TransactionClient, 'adStakePosition'>;
type AdsProjectionClient = Pick<PrismaClient, '$transaction'>;

export interface AdPositionChange {
  chainId: number;
  contractAddress: string;
  keyword: string;
  stakerAddress: string;
  stakeRaw: string;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
}

export interface AdsProjectionIdentity {
  chainId: number;
  contractAddress: string;
}

function validAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
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
  let stake: bigint;
  try {
    stake = BigInt(change.stakeRaw);
  } catch {
    throw new Error('PRE Keyword Market position event contains an invalid stake amount');
  }
  if (stake < 0n) throw new Error('PRE Keyword Market position stake cannot be negative');
  const identity = {
    chainId: change.chainId,
    contractAddress: change.contractAddress.toLowerCase(),
    canonicalKeyword: normalizeAdKeyword(change.keyword),
    stakerAddress: change.stakerAddress.toLowerCase(),
  };
  const current = await database.adStakePosition.findUnique({
    where: { chainId_contractAddress_canonicalKeyword_stakerAddress: identity },
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
    amountSinceBlock: amountChanged ? change.blockNumber : current.amountSinceBlock,
    amountSinceLogIndex: amountChanged ? change.logIndex : current.amountSinceLogIndex,
    positionBlock: change.blockNumber,
    positionBlockHash: change.blockHash.toLowerCase(),
    positionTxHash: change.txHash.toLowerCase(),
    positionLogIndex: change.logIndex,
    active: stake > 0n,
  };
  await database.adStakePosition.upsert({
    where: { chainId_contractAddress_canonicalKeyword_stakerAddress: identity },
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
  return database.$transaction(async (tx) => {
    const event = await tx.adChainEvent.createMany({
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
            keyword: change.keyword,
            stakerAddress: change.stakerAddress.toLowerCase(),
            stakeRaw: change.stakeRaw,
          },
        },
      ],
      skipDuplicates: true,
    });
    if (event.count !== 1) return { applied: false, reason: 'DUPLICATE_EVENT' as const };
    return applyAdPositionChange(tx, change);
  });
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
) {
  const normalized = {
    chainId: identity.chainId,
    contractAddress: identity.contractAddress.toLowerCase(),
  };
  return database.adIndexerState.upsert({
    where: { key: adsIndexerStateKey(identity) },
    update: { ...normalized, lastBlockNumber, lastBlockHash: lastBlockHash.toLowerCase() },
    create: {
      key: adsIndexerStateKey(identity),
      ...normalized,
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
  return database.$transaction((tx) => resetAdsProjection(tx, identity));
}
