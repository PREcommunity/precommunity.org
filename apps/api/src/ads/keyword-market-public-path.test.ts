import { describe, expect, it } from 'vitest';
import { isPublicKeywordMarketPath } from './keyword-market-public-path';

describe('PRE Keyword Market public API paths', () => {
  it.each([
    '/v1/keyword-market/status',
    '/v1/keyword-market/resolve',
    '/v1/keyword-market/keywords/bitcoin%20poland',
    '/v1/keyword-market/revisions/00000000-0000-4000-8000-000000000001/reports',
  ])('allows public CORS for %s', (path) => {
    expect(isPublicKeywordMarketPath(path)).toBe(true);
  });

  it.each([
    '/v1/keyword-market/campaigns',
    '/v1/keyword-market/admin/reports',
    '/v1/ads/resolve',
    '/v1/ads/keywords/bitcoin',
  ])('does not expose private or legacy path %s', (path) => {
    expect(isPublicKeywordMarketPath(path)).toBe(false);
  });
});
