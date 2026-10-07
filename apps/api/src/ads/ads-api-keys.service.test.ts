import { AdCreativeStatus } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { hashAdApiKey } from './ads-api-key.guard';
import { AdsService } from './ads.service';

const principal = { address: '0x0000000000000000000000000000000000000001' } as never;
const keyMetadata = {
  id: 'key-1',
  name: 'Search engine',
  keyPrefix: 'pkm_abcdefgh',
  createdAt: new Date('2026-10-07T12:00:00Z'),
  lastUsedAt: null,
  revokedAt: null,
};

describe('named integration key lifecycle', () => {
  it('returns the secret only at creation and keeps it and its digest out of metadata and audit', async () => {
    const create = vi.fn(async ({ data }) => ({
      ...data,
      ...keyMetadata,
      keyPrefix: data.keyPrefix,
    }));
    const audit = vi.fn();
    const tx = {
      adApiKey: { create },
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1' }) },
      auditEvent: { create: audit },
    };
    const findMany = vi.fn().mockResolvedValue([{ ...keyMetadata, keyHash: 'hidden-digest' }]);
    const service = new AdsService(
      {
        $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
        adApiKey: { findMany },
      } as never,
      {} as never,
      {} as never,
    );
    const created = await service.createApiKey({ name: '  Search engine  ' }, principal);
    expect(created.apiKey).toMatch(/^pkm_[A-Za-z0-9_-]{43}$/);
    expect(create.mock.calls[0]![0].data).toMatchObject({
      name: 'Search engine',
      keyHash: hashAdApiKey(created.apiKey),
      keyPrefix: created.apiKey.slice(0, 12),
    });
    const persisted = JSON.stringify(create.mock.calls);
    expect(persisted).not.toContain(created.apiKey);
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).not.toContain(created.apiKey);
    expect(logged).not.toContain(hashAdApiKey(created.apiKey));
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityType: 'AD_API_KEY', action: 'AD_API_KEY_CREATE' }),
    });
    const listed = await service.apiKeys();
    expect(listed[0]).toEqual({
      id: 'key-1',
      name: keyMetadata.name,
      prefix: keyMetadata.keyPrefix,
      createdAt: keyMetadata.createdAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(listed)).not.toContain('hidden-digest');
    expect(listed[0]).not.toHaveProperty('apiKey');
  });

  it('soft revokes once, preserves the audit, and rejects unknown key IDs', async () => {
    const findUnique = vi.fn().mockResolvedValue(keyMetadata);
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
    const audit = vi.fn();
    const tx = {
      adApiKey: { findUnique, updateMany },
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1' }) },
      auditEvent: { create: audit },
    };
    const service = new AdsService(
      { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) } as never,
      {} as never,
      {} as never,
    );
    await service.revokeApiKey('key-1', principal);
    await service.revokeApiKey('key-1', principal);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'key-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityType: 'AD_API_KEY', action: 'AD_API_KEY_REVOKE' }),
    });
    findUnique.mockResolvedValueOnce(null);
    await expect(service.revokeApiKey('missing', principal)).rejects.toThrow('API key not found');
  });
});

describe('server-side click redirects', () => {
  it('uses the original stored destination and accepts old published revisions without campaign/stake requirements', async () => {
    const findFirst = vi.fn().mockResolvedValue({ destinationUrl: 'https://wp.pl/original' });
    const incrementClick = vi.fn().mockResolvedValue(false);
    const service = new AdsService(
      { adCreativeRevision: { findFirst } } as never,
      { incrementClick } as never,
      {} as never,
    );
    await expect(service.click('old-revision')).resolves.toBe('https://wp.pl/original');
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'old-revision',
        OR: [
          { status: AdCreativeStatus.APPROVED },
          { status: AdCreativeStatus.SUPERSEDED, moderatedAt: { not: null } },
        ],
      },
      select: { destinationUrl: true },
    });
    expect(incrementClick).toHaveBeenCalledWith('old-revision');
    await expect(service.click('old-revision', false)).resolves.toBe('https://wp.pl/original');
    expect(incrementClick).toHaveBeenCalledOnce();
  });

  it('does not count an unknown, suspended or never-approved revision', async () => {
    const incrementClick = vi.fn();
    const service = new AdsService(
      { adCreativeRevision: { findFirst: vi.fn().mockResolvedValue(null) } } as never,
      { incrementClick } as never,
      {} as never,
    );
    await expect(service.click('unavailable')).rejects.toThrow('Ad revision not found');
    expect(incrementClick).not.toHaveBeenCalled();
  });
});
