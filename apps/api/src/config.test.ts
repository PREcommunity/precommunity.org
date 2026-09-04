import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

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
  ])('rejects production placeholder %s = %s', async (name, value, message) => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
    vi.stubEnv('ADS_REPORT_FINGERPRINT_SECRET', 'b'.repeat(40));
    vi.stubEnv(name, value);
    await expect(import('./config')).rejects.toThrow(message);
  });
  it('keeps HTTP defaults and origin normalization', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WEB_ORIGIN', 'https://community.example/path');
    const { config } = await import('./config');
    expect(config.allowedWebOrigins).toEqual(['https://community.example']);
    expect(config.BASE_CHAIN_ID).toBe(config.deployment.chainId);
  });
});
