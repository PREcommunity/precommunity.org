import type { PrismaClient } from './generated/prisma/client';

export async function readLatestPreUsdPrice(database: Pick<PrismaClient, 'preUsdPrice'>) {
  const quote = await database.preUsdPrice.findFirst({
    where: { source: 'COINGECKO', assetId: 'presearch' },
    orderBy: { quotedAt: 'desc' },
  });
  return quote
    ? {
        id: quote.id,
        source: 'COINGECKO' as const,
        assetId: 'presearch' as const,
        priceUsd: quote.priceUsd.toFixed(),
        quotedAt: quote.quotedAt.toISOString(),
        fetchedAt: quote.fetchedAt.toISOString(),
      }
    : null;
}
