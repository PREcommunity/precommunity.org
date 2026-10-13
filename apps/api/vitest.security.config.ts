import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config';

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    env: {
      ...unitConfig.test?.env,
      REDIS_URL: process.env.TEST_ADS_REDIS_URL ?? 'redis://127.0.0.1:6379',
      REDIS_URL_TESTNET: process.env.TEST_ADS_REDIS_URL ?? 'redis://127.0.0.1:6379',
    },
    include: ['tests/ads-security.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
