import type { PrismaClient } from './generated/prisma/client';

export interface ApplicationFeatures {
  keywordMarketEnabled: boolean;
  keywordMarketRequireReview: boolean;
}

type ApplicationFeaturesDatabase = Pick<PrismaClient, 'communitySettings'>;

export async function readApplicationFeatures(
  database: ApplicationFeaturesDatabase,
): Promise<ApplicationFeatures> {
  const settings = await database.communitySettings.findFirst({
    where: { project: { slug: 'precommunity' } },
    select: { keywordMarketEnabled: true, keywordMarketRequireReview: true },
  });

  return {
    keywordMarketEnabled: settings?.keywordMarketEnabled ?? false,
    keywordMarketRequireReview: settings?.keywordMarketRequireReview ?? true,
  };
}
