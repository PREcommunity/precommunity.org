import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const e2eUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const externalServers = process.env.PLAYWRIGHT_EXTERNAL_SERVERS === '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: e2eUrl, trace: 'retain-on-failure' },
  webServer: externalServers
    ? undefined
    : [
        {
          command: 'node tests/chain-harness.mjs',
          url: 'http://127.0.0.1:4100/health',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: 'pnpm dev:e2e',
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
