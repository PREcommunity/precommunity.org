import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const secretFixtures = {
  SESSION_SECRET: 'a'.repeat(40),
  ADS_REPORT_FINGERPRINT_SECRET: 'b'.repeat(40),
  ADS_DELIVERY_SECRET: 'c'.repeat(40),
  ADS_CLICK_FINGERPRINT_SECRET: 'd'.repeat(40),
};

function productionSecrets() {
  vi.stubEnv('NODE_ENV', 'production');
  for (const [name, value] of Object.entries(secretFixtures)) vi.stubEnv(name, value);
}

describe('API-only secret validation', () => {
  it.each([
    ['SESSION_SECRET', 'development-only-session-secret-change-me', 'explicit session secret'],
    ['SESSION_SECRET', 'replace-with-at-least-32-random-characters', 'explicit session secret'],
    [
      'ADS_REPORT_FINGERPRINT_SECRET',
      'development-only-ads-report-secret',
      'independent PRE Keyword Market',
    ],
    [
      'ADS_REPORT_FINGERPRINT_SECRET',
      'replace-with-an-independent-ads-report-secret',
      'independent PRE Keyword Market',
    ],
    ['ADS_DELIVERY_SECRET', 'development-only-ads-delivery-secret', 'delivery secret'],
    ['ADS_DELIVERY_SECRET', 'replace-with-an-independent-ads-delivery-secret', 'delivery secret'],
    ['ADS_DELIVERY_SECRET', 'development-only-session-secret-change-me', 'delivery secret'],
    [
      'ADS_CLICK_FINGERPRINT_SECRET',
      'development-only-ads-click-fingerprint-secret',
      'click fingerprint secret',
    ],
    [
      'ADS_CLICK_FINGERPRINT_SECRET',
      'replace-with-an-independent-ads-click-fingerprint-secret',
      'click fingerprint secret',
    ],
  ])('rejects production placeholder %s = %s', async (name, value, message) => {
    vi.resetModules();
    productionSecrets();
    vi.stubEnv(name, value);
    await expect(import('./config')).rejects.toThrow(message);
  });

  it.each(Object.keys(secretFixtures))('requires at least 32 characters for %s', async (name) => {
    productionSecrets();
    vi.stubEnv(name, 'short');
    await expect(import('./config')).rejects.toThrow(name);
  });

  it.each(['ADS_DELIVERY_SECRET', 'ADS_CLICK_FINGERPRINT_SECRET'])(
    'requires %s in production',
    async (name) => {
      productionSecrets();
      vi.stubEnv(name, undefined);
      await expect(import('./config')).rejects.toThrow(name);
    },
  );

  it.each(
    Object.keys(secretFixtures).flatMap((name, index, names) =>
      names.slice(index + 1).map((other) => [name, other]),
    ),
  )('rejects reusing %s as %s', async (name, other) => {
    productionSecrets();
    vi.stubEnv(other!, secretFixtures[name as keyof typeof secretFixtures]);
    await expect(import('./config')).rejects.toThrow('must be independent');
  });

  it('accepts independent production secrets', async () => {
    productionSecrets();
    const { config } = await import('./config');
    expect(config).toMatchObject(secretFixtures);
  });

  it('keeps HTTP defaults and origin normalization', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WEB_ORIGIN', 'https://community.example/path');
    const { config } = await import('./config');
    expect(config.allowedWebOrigins).toEqual(['https://community.example']);
    expect(config.BASE_CHAIN_ID).toBe(config.deployment.chainId);
    expect(
      new Set(
        Object.keys(secretFixtures).map((name) => config[name as keyof typeof secretFixtures]),
      ).size,
    ).toBe(4);
  });

  it('uses the selected keystore pair and ignores the legacy plaintext signing key', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ADS_OPERATOR_PRIVATE_KEY', 'not-a-private-key');
    vi.stubEnv('PRECOMMUNITY_NETWORK', 'base-sepolia');
    vi.stubEnv('ADS_OPERATOR_KEYSTORE_PATH_TESTNET', '/private/operator-fixture.json');
    vi.stubEnv('ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET', ' exact fixture password ');
    const { config } = await import('./config');
    expect(config.adsOperator).toEqual({
      keystorePath: '/private/operator-fixture.json',
      password: ' exact fixture password ',
    });
    expect(config).not.toHaveProperty('ADS_OPERATOR_PRIVATE_KEY');
  });
});
