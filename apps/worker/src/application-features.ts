import { readApplicationFeatures } from '@precommunity/database';
import type { PrismaClient } from '@precommunity/database';

type ApplicationFeaturesDatabase = Parameters<typeof readApplicationFeatures>[0];

export async function runKeywordMarketJob<T>(
  database: ApplicationFeaturesDatabase,
  run: () => Promise<T>,
): Promise<T | { status: 'DISABLED'; feature: 'keyword-market' }> {
  const features = await readApplicationFeatures(database);
  if (!features.keywordMarketEnabled) {
    return { status: 'DISABLED', feature: 'keyword-market' };
  }
  return run();
}

/** Disabling ad delivery must not strand existing click debt during the withdrawal window. */
export async function runKeywordMarketIndexing<T>(
  database: ApplicationFeaturesDatabase & Pick<PrismaClient, 'adBillingClick' | 'adChargeBatch'>,
  run: () => Promise<T>,
  identity: { chainId: number; contractAddress: string | null },
) {
  const features = await readApplicationFeatures(database);
  if (features.keywordMarketEnabled) return run();
  if (identity.contractAddress) {
    const [click, batch] = await Promise.all([
      database.adBillingClick.findFirst({
        where: {
          ...identity,
          contractAddress: identity.contractAddress,
          status: { in: ['CAPTURING', 'PRICE_PENDING', 'PENDING', 'RESERVED'] },
        },
        select: { id: true },
      }),
      database.adChargeBatch.findFirst({
        where: {
          ...identity,
          contractAddress: identity.contractAddress,
          status: { in: ['PREPARED', 'SIGNED', 'SUBMITTED', 'FAILED', 'RECONCILING'] },
        },
        select: { id: true },
      }),
    ]);
    if (click || batch) return run();
  }
  return { status: 'DISABLED', feature: 'keyword-market' };
}
