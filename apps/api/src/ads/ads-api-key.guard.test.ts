import type { ExecutionContext } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdsApiKeyGuard, hashAdApiKey } from './ads-api-key.guard';

const apiKey = `pkm_${'a'.repeat(43)}`;
const now = new Date('2026-10-13T12:00:00.000Z');
const activeKey = { id: 'key-1', revokedAt: null, lastUsedAt: null as Date | null };
const context = (value: unknown, response = { setHeader: vi.fn() }) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-api-key': value } }),
      getResponse: () => response,
    }),
  }) as ExecutionContext;

function fixture() {
  const findUnique = vi.fn().mockResolvedValue(activeKey);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const consume = vi.fn().mockResolvedValue(0);
  const guard = new AdsApiKeyGuard(
    { adApiKey: { findUnique, updateMany } } as never,
    { consume } as never,
  );
  return { guard, findUnique, updateMany, consume };
}

describe('keyword market API key authentication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it.each([undefined, '', 'wrong', [apiKey, apiKey]])(
    'rejects a malformed header %j before rate limiting or database access',
    async (header) => {
      const { guard, consume, findUnique, updateMany } = fixture();
      await expect(guard.canActivate(context(header))).rejects.toThrow('Invalid API key');
      expect(consume).not.toHaveBeenCalled();
      expect(findUnique).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('authenticates by digest and records first use without persisting the credential', async () => {
    const { guard, consume, findUnique, updateMany } = fixture();
    await expect(guard.canActivate(context(apiKey))).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith(hashAdApiKey(apiKey));
    expect(findUnique).toHaveBeenCalledWith({
      where: { keyHash: hashAdApiKey(apiKey) },
      select: { id: true, revokedAt: true, lastUsedAt: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: activeKey.id,
        revokedAt: null,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: new Date(now.getTime() - 60_000) } }],
      },
      data: { lastUsedAt: now },
    });
    expect(
      JSON.stringify([consume.mock.calls, findUnique.mock.calls, updateMany.mock.calls]),
    ).not.toContain(apiKey);
  });

  it('limits a key before database access and tells the caller when to retry', async () => {
    const { guard, consume, findUnique, updateMany } = fixture();
    consume.mockResolvedValue(17);
    const response = { setHeader: vi.fn() };
    await expect(guard.canActivate(context(apiKey, response))).rejects.toMatchObject({
      status: 429,
    });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([null, { ...activeKey, revokedAt: now }])(
    'rejects an unknown or revoked key without recording usage',
    async (key) => {
      const { guard, findUnique, updateMany } = fixture();
      findUnique.mockResolvedValue(key);
      await expect(guard.canActivate(context(apiKey))).rejects.toThrow('Invalid API key');
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('checks the live key on every request so revocation takes effect immediately', async () => {
    const { guard, findUnique, updateMany } = fixture();
    findUnique
      .mockResolvedValueOnce({ ...activeKey, lastUsedAt: now })
      .mockResolvedValue({ ...activeKey, lastUsedAt: now, revokedAt: now });
    await expect(guard.canActivate(context(apiKey))).resolves.toBe(true);
    await expect(guard.canActivate(context(apiKey))).rejects.toThrow('Invalid API key');
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('fails closed during a database outage without exposing the credential or database error', async () => {
    const { guard, findUnique, updateMany } = fixture();
    findUnique.mockRejectedValue(new Error(`database ${apiKey}`));
    await expect(guard.canActivate(context(apiKey))).rejects.toThrow(
      'API key authentication is unavailable',
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('skips usage writes less than a minute after the previous use', async () => {
    const { guard, findUnique, updateMany } = fixture();
    findUnique.mockResolvedValue({ ...activeKey, lastUsedAt: new Date(now.getTime() - 59_999) });
    await expect(guard.canActivate(context(apiKey))).resolves.toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([60_000, 120_000])('updates usage when its timestamp is %dms old', async (age) => {
    const { guard, findUnique, updateMany } = fixture();
    findUnique.mockResolvedValue({ ...activeKey, lastUsedAt: new Date(now.getTime() - age) });
    await expect(guard.canActivate(context(apiKey))).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('accepts a request when another instance already updated usage', async () => {
    const { guard, updateMany } = fixture();
    updateMany.mockResolvedValue({ count: 0 });
    await expect(guard.canActivate(context(apiKey))).resolves.toBe(true);
  });

  it('keeps authorization available when the optional usage write fails', async () => {
    const { guard, updateMany } = fixture();
    updateMany.mockRejectedValue(new Error(`database ${apiKey}`));
    await expect(guard.canActivate(context(apiKey))).resolves.toBe(true);
  });
});
