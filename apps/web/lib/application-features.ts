export interface ApplicationFeatures {
  keywordMarketEnabled: boolean;
  keywordMarketRequireReview: boolean;
}

export const DISABLED_APPLICATION_FEATURES: ApplicationFeatures = {
  keywordMarketEnabled: false,
  keywordMarketRequireReview: true,
};

export const APPLICATION_FEATURES_CHANGED_EVENT = 'precommunity:application-features-changed';
