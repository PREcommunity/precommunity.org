import { AdCreativeStatus, Prisma } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { AdsService } from './ads.service';

const principal = { userId: 'user-1', address: `0x${'1'.repeat(40)}` } as never;
const creative = {
  headline: 'Result headline',
  description: 'A useful destination.',
  destinationUrl: 'https://example.com/result',
};

function fixture(requireReview: boolean | null) {
  const settings = vi
    .fn()
    .mockResolvedValue(
      requireReview === null ? null : { keywordMarketRequireReview: requireReview },
    );
  const tx = {
    communitySettings: { findFirst: settings },
    adCampaign: {
      create: vi.fn().mockResolvedValue({
        id: 'campaign-1',
        canonicalKeyword: 'bitcoin',
        revisions: [{ id: 'revision-1' }],
      }),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue({
        id: 'campaign-1',
        activeRevisionId: 'revision-1',
        pausedAt: new Date(0),
        revisions: [{ version: 3 }],
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    adCreativeRevision: {
      create: vi.fn().mockResolvedValue({ id: 'revision-4', version: 4 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const transaction = vi.fn((callback: (client: typeof tx) => unknown) => callback(tx));
  const service = new AdsService({ $transaction: transaction } as never, {} as never, {} as never);
  return { service, tx, settings, transaction };
}

describe('Keyword Marketplace review requirement', () => {
  it.each([true, null])('keeps new campaigns pending with review setting %s', async (setting) => {
    const { service, tx } = fixture(setting);

    await expect(
      service.createCampaign({ keyword: 'Bitcoin', ...creative }, principal),
    ).resolves.toEqual({ id: 'campaign-1', keyword: 'bitcoin', revisionId: 'revision-1' });
    expect(tx.adCampaign.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        canonicalKeyword: 'bitcoin',
        revisions: {
          create: {
            version: 1,
            ...creative,
            displayDomain: 'example.com',
            status: AdCreativeStatus.PENDING_REVIEW,
            moderatedAt: null,
          },
        },
      },
      include: { revisions: true },
    });
    expect(tx.adCampaign.update).not.toHaveBeenCalled();
  });

  it('publishes the initial creative in the same transaction when review is disabled', async () => {
    const { service, tx, transaction } = fixture(false);
    await service.createCampaign({ keyword: 'bitcoin', ...creative }, principal);

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.adCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revisions: {
            create: expect.objectContaining({
              status: AdCreativeStatus.APPROVED,
              moderatedAt: expect.any(Date),
            }),
          },
        }),
      }),
    );
    expect(tx.adCampaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { activeRevisionId: 'revision-1' },
    });
  });

  it.each([true, null])(
    'preserves the active creative while a new revision awaits review %s',
    async (setting) => {
      const { service, tx } = fixture(setting);
      await expect(service.createRevision('campaign-1', creative, principal)).resolves.toEqual({
        revisionId: 'revision-4',
        version: 4,
      });

      expect(tx.adCreativeRevision.create).toHaveBeenCalledWith({
        data: {
          campaignId: 'campaign-1',
          version: 4,
          ...creative,
          displayDomain: 'example.com',
          status: AdCreativeStatus.PENDING_REVIEW,
          moderatedAt: null,
        },
      });
      expect(tx.adCreativeRevision.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { campaignId: 'campaign-1', status: AdCreativeStatus.PENDING_REVIEW },
        data: { status: AdCreativeStatus.SUPERSEDED },
      });
      expect(tx.adCampaign.updateMany).not.toHaveBeenCalled();
    },
  );

  it('supersedes and activates a new approved revision without unpausing the campaign', async () => {
    const { service, tx } = fixture(false);
    await service.createRevision('campaign-1', creative, principal);

    expect(tx.adCreativeRevision.create).toHaveBeenCalledWith({
      data: {
        campaignId: 'campaign-1',
        version: 4,
        ...creative,
        displayDomain: 'example.com',
        status: AdCreativeStatus.APPROVED,
        moderatedAt: expect.any(Date),
      },
    });
    expect(tx.adCreativeRevision.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'revision-1', status: AdCreativeStatus.APPROVED },
      data: { status: AdCreativeStatus.SUPERSEDED },
    });
    expect(tx.adCampaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'campaign-1', activeRevisionId: 'revision-1' },
      data: { activeRevisionId: 'revision-4' },
    });
  });

  it('publishes a revision when the campaign has no active creative', async () => {
    const { service, tx } = fixture(false);
    tx.adCampaign.findFirst.mockResolvedValue({
      id: 'campaign-1',
      activeRevisionId: null,
      pausedAt: null,
      revisions: [{ version: 3 }],
    });
    await service.createRevision('campaign-1', creative, principal);

    expect(tx.adCreativeRevision.updateMany).toHaveBeenCalledOnce();
    expect(tx.adCampaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'campaign-1', activeRevisionId: null },
      data: { activeRevisionId: 'revision-4' },
    });
  });

  it('rejects publication if another moderation action changes the active revision', async () => {
    const { service, tx } = fixture(false);
    tx.adCampaign.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.createRevision('campaign-1', creative, principal)).rejects.toThrow(
      'The moderation state changed; reload and try again',
    );
  });

  it('detects a changed active creative before touching pending drafts', async () => {
    const { service, tx } = fixture(false);
    tx.adCreativeRevision.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.createRevision('campaign-1', creative, principal)).rejects.toThrow(
      'The moderation state changed; reload and try again',
    );
    expect(tx.adCreativeRevision.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'revision-1', status: AdCreativeStatus.APPROVED },
      data: { status: AdCreativeStatus.SUPERSEDED },
    });
    expect(tx.adCreativeRevision.create).not.toHaveBeenCalled();
    expect(tx.adCampaign.updateMany).not.toHaveBeenCalled();
  });

  it('requires ownership before reading settings or writing a revision', async () => {
    const { service, tx, settings } = fixture(false);
    tx.adCampaign.findFirst.mockResolvedValue(null);
    await expect(service.createRevision('campaign-other', creative, principal)).rejects.toThrow(
      'Ad campaign not found',
    );
    expect(tx.adCampaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'campaign-other', userId: 'user-1' } }),
    );
    expect(settings).not.toHaveBeenCalled();
    expect(tx.adCreativeRevision.create).not.toHaveBeenCalled();
  });

  it('preserves the duplicate campaign conflict response', async () => {
    const { service, tx } = fixture(false);
    tx.adCampaign.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate campaign', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );
    await expect(
      service.createCampaign({ keyword: 'bitcoin', ...creative }, principal),
    ).rejects.toThrow('This wallet already has a campaign for that keyword');
    expect(tx.adCampaign.update).not.toHaveBeenCalled();
  });
});
