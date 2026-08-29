import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const e2eUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: e2eUrl, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node tests/chain-harness.mjs',
      url: 'http://127.0.0.1:4100/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `INTERNAL_API_URL=http://127.0.0.1:4100 NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 NEXT_PUBLIC_BASE_RPC_URL=http://127.0.0.1:4100/rpc NEXT_DIST_DIR=.next-e2e node_modules/.bin/next dev -H 127.0.0.1 -p ${e2ePort}`,
      url: e2eUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
});
