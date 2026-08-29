import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, requestJson } from './http';

afterEach(() => vi.unstubAllGlobals());

describe('requestJson', () => {
  it('returns valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));

    await expect(requestJson<{ ok: boolean }>('https://example.test')).resolves.toEqual({
      ok: true,
    });
  });

  it.each([
    ['', 'API returned an empty response'],
    ['not-json', 'API returned invalid JSON'],
  ])('rejects an unusable success body', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

    await expect(requestJson('https://example.test')).rejects.toThrow(message);
  });

  it('uses a NestJS validation message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: ['Title is required', 'Body is too short'] }), {
          status: 400,
        }),
      ),
    );

    await expect(requestJson('https://example.test')).rejects.toMatchObject({
      status: 400,
      message: 'Title is required · Body is too short',
    });
  });

  it('preserves a 404 status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

    const error = await requestJson('https://example.test', undefined, 'Goal API').catch(
      (reason) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: 'Goal API returned 404' });
  });

  it('normalizes a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    const error = await requestJson('https://example.test', undefined, 'Forum API').catch(
      (reason) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, message: 'Forum API could not be reached' });
  });

  it('rethrows Next.js dynamic rendering signals unchanged', async () => {
    const dynamicUsage = Object.assign(new Error('Dynamic server usage'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(dynamicUsage));

    await expect(requestJson('https://example.test')).rejects.toBe(dynamicUsage);
  });
});
