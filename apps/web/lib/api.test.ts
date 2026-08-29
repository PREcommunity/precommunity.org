import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCommunityProfile, getDashboard, getDashboardAvailability, getGoal } from './api';

describe('verified API policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('surfaces a dashboard 503 instead of substituting local values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(getDashboard()).rejects.toThrow('Verified ledger API returned 503');
  });

  it('lets pages render an explicit unavailable state for a dashboard 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(getDashboardAvailability()).resolves.toEqual({
      status: 'UNAVAILABLE',
      dashboard: null,
    });
  });

  it('does not hide unexpected dashboard failures behind the unavailable state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(getDashboardAvailability()).rejects.toThrow('Verified ledger API returned 500');
  });

  it('returns null only for an explicit goal 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(getGoal('missing')).resolves.toBeNull();
  });

  it('reports an empty successful profile response without leaking a JSON parser error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(getCommunityProfile('0x0000000000000000000000000000000000000001')).rejects.toThrow(
      'Community profile API returned an empty response',
    );
  });

  it('keeps API-owned profile assets behind a relative production API prefix', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '/api');
    vi.resetModules();
    const { resolveApiAssetUrl } = await import('./api');

    expect(resolveApiAssetUrl('/v1/public/profiles/0x123/avatar?revision=4')).toBe(
      '/api/v1/public/profiles/0x123/avatar?revision=4',
    );
  });

  it('preserves absolute HTTP asset URLs', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '/api');
    vi.resetModules();
    const { resolveApiAssetUrl } = await import('./api');

    expect(resolveApiAssetUrl('https://cdn.example/avatar.png')).toBe(
      'https://cdn.example/avatar.png',
    );
    expect(resolveApiAssetUrl('javascript:alert(1)')).toBeNull();
  });
});
