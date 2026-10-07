import { AdCreativeStatus, AdReportStatus } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { AdModerationAction, AdReportResolutionAction } from './ads.dto';
import { AdsService } from './ads.service';

const principal = { address: '0x0000000000000000000000000000000000000001' } as never;

function supersededFixture(published = true) {
  const revision = {
    id: 'old-revision',
    campaignId: 'campaign-1',
    status: AdCreativeStatus.SUPERSEDED as AdCreativeStatus,
    moderatedAt: published ? new Date('2026-10-01T00:00:00Z') : null,
    destinationUrl: 'https://example.com/original',
    headline: 'Old creative',
    description: 'Previous version',
    displayDomain: 'example.com',
    version: 1,
    moderationNote: null,
    lifetimeResolutions: 0n,
    dailyMetrics: [],
    reportAggregates: [],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    campaign: {
      id: 'campaign-1',
      activeRevisionId: 'new-revision',
      canonicalKeyword: 'bitcoin',
      user: { address: '0x0000000000000000000000000000000000000001' },
    },
  };
  type Where = { status?: AdCreativeStatus; moderatedAt?: { not: null } };
  const matches = (where: Where) =>
    (!where.status || where.status === revision.status) &&
    (!where.moderatedAt || revision.moderatedAt !== null);
  const revisionUpdate = vi.fn(
    async ({ where, data }: { where: Where; data: Partial<typeof revision> }) => {
      if (!matches(where)) return { count: 0 };
      Object.assign(revision, data);
      return { count: 1 };
    },
  );
  const reportUpdate = vi.fn().mockResolvedValue({ count: 1 });
  const campaignUpdate = vi.fn().mockResolvedValue({ count: 1 });
  const audit = vi.fn();
  const tx = {
    adCreativeRevision: {
      findUnique: vi.fn(async () => ({ ...revision })),
      updateMany: revisionUpdate,
    },
    adCampaign: { updateMany: campaignUpdate },
    adReport: { count: vi.fn().mockResolvedValue(1), updateMany: reportUpdate },
    project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1' }) },
    auditEvent: { create: audit },
  };
  const incrementClick = vi.fn().mockResolvedValue(true);
  const service = new AdsService(
    {
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
      adCreativeRevision: {
        findMany: vi.fn(async () => [{ ...revision }]),
        findFirst: vi.fn(async ({ where }: { where: { OR: Where[] } }) =>
          where.OR.some(matches) ? { destinationUrl: revision.destinationUrl } : null,
        ),
      },
    } as never,
    { incrementClick } as never,
    { snapshot: () => ({ status: 'AWAITING_CONTRACT' }) } as never,
  );
  return { service, revision, revisionUpdate, reportUpdate, campaignUpdate, audit, incrementClick };
}

describe('moderating previously published redirect links', () => {
  it.each(['direct', 'reports'] as const)(
    'blocks the superseded redirect through %s suspension and keeps the newer creative active',
    async (path) => {
      const {
        service,
        revision,
        revisionUpdate,
        reportUpdate,
        campaignUpdate,
        audit,
        incrementClick,
      } = supersededFixture();
      await expect(service.click(revision.id)).resolves.toBe('https://example.com/original');
      if (path === 'direct') {
        await service.moderateRevision(
          revision.id,
          AdModerationAction.SUSPEND,
          'Unsafe destination',
          principal,
        );
      } else {
        await service.resolveReports(
          revision.id,
          AdReportResolutionAction.SUSPEND_AD,
          'Unsafe destination',
          principal,
        );
        expect(reportUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: AdReportStatus.ACTIONED }),
          }),
        );
      }
      expect(revisionUpdate).toHaveBeenCalledWith({
        where: { id: revision.id, status: AdCreativeStatus.SUPERSEDED, moderatedAt: { not: null } },
        data: expect.objectContaining({ status: AdCreativeStatus.SUSPENDED }),
      });
      expect(revision.status).toBe(AdCreativeStatus.SUSPENDED);
      expect(campaignUpdate).not.toHaveBeenCalled();
      expect(revision.campaign.activeRevisionId).toBe('new-revision');
      await expect(service.click(revision.id)).rejects.toThrow('Ad revision not found');
      expect(incrementClick).toHaveBeenCalledOnce();
      expect(audit).toHaveBeenCalledOnce();
    },
  );

  it('does not let an unpublished superseded draft enter the suspend/restore lifecycle', async () => {
    const { service, revision, revisionUpdate, audit } = supersededFixture(false);
    await expect(
      service.moderateRevision(revision.id, AdModerationAction.SUSPEND, undefined, principal),
    ).rejects.toThrow('Only a published revision can be suspended');
    expect(revisionUpdate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await expect(service.click(revision.id)).rejects.toThrow('Ad revision not found');
  });

  it.each([true, false])(
    'exposes suspension availability for a superseded revision with publication=%s',
    async (published) => {
      const { service } = supersededFixture(published);
      await expect(service.adminRevisions(AdCreativeStatus.SUPERSEDED)).resolves.toEqual([
        expect.objectContaining({ canSuspend: published }),
      ]);
    },
  );
});
