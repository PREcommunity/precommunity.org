export interface ApplicationFeatures {
  keywordMarketEnabled: boolean;
}

export const DISABLED_APPLICATION_FEATURES: ApplicationFeatures = {
  keywordMarketEnabled: false,
};

export const APPLICATION_FEATURES_CHANGED_EVENT = 'precommunity:application-features-changed';
