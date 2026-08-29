import type { Prisma } from './generated/prisma/client';

type AdsProjectionDatabase = Pick<
  Prisma.TransactionClient,
  'adChainEvent' | 'adIndexerState' | 'adStakePosition'
>;

export interface AdsProjectionIdentity {
  chainId: number;
  contractAddress: string;
}

/** Clears only rebuildable PRE Keyword Market chain data; campaigns, creatives and reports are retained. */
export async function resetAdsProjection(
  database: AdsProjectionDatabase,
  identity: AdsProjectionIdentity,
) {
  const where = {
    chainId: identity.chainId,
    contractAddress: identity.contractAddress.toLowerCase(),
  };
  const positions = await database.adStakePosition.deleteMany({ where });
  const events = await database.adChainEvent.deleteMany({ where });
  const states = await database.adIndexerState.deleteMany({ where });
  return { positions: positions.count, events: events.count, states: states.count };
}
