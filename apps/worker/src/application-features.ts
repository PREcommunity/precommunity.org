import { readApplicationFeatures } from '@precommunity/database';

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
