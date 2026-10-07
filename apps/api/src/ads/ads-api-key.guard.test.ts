import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdsApiKeyGuard, hashAdApiKey } from './ads-api-key.guard';

const apiKey = `pkm_${'a'.repeat(43)}`;
const context = (value: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-api-key': value } }) }),
  }) as ExecutionContext;

describe('keyword market API key authentication', () => {
  it.each([undefined, '', 'wrong', [apiKey, apiKey]])(
    'rejects a malformed header %j before database access',
    async (header) => {
      const updateMany = vi.fn();
      const guard = new AdsApiKeyGuard({ adApiKey: { updateMany } } as never);
      await expect(guard.canActivate(context(header))).rejects.toThrow('Invalid API key');
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('authenticates by digest and records last use without persisting the credential', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const guard = new AdsApiKeyGuard({ adApiKey: { updateMany } } as never);
    await expect(guard.canActivate(context(apiKey))).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { keyHash: hashAdApiKey(apiKey), revokedAt: null },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain(apiKey);
  });

  it('checks the active key on every request so revocation takes effect immediately', async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
    const guard = new AdsApiKeyGuard({ adApiKey: { updateMany } } as never);
    await expect(guard.canActivate(context(apiKey))).resolves.toBe(true);
    await expect(guard.canActivate(context(apiKey))).rejects.toThrow('Invalid API key');
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('fails closed during a database outage without exposing the credential or database error', async () => {
    const guard = new AdsApiKeyGuard({
      adApiKey: { updateMany: vi.fn().mockRejectedValue(new Error(`database ${apiKey}`)) },
    } as never);
    await expect(guard.canActivate(context(apiKey))).rejects.toThrow(
      'API key authentication is unavailable',
    );
  });
});
