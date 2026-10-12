import { ChainAuthorityKind, Role } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPrincipal } from '../common/request-context';
import type { PrismaService } from '../common/prisma.service';
import { ApplicationFeaturesService } from './application-features.service';

const actor: AuthenticatedPrincipal = {
  userId: '00000000-0000-4000-8000-000000000001',
  address: '0x1111111111111111111111111111111111111111',
  roles: [Role.SUPER_ADMIN],
  chainAuthorities: [ChainAuthorityKind.OWNER],
  chainOwnerAddress: '0x1111111111111111111111111111111111111111',
  safeOwner: false,
  canAccessSafeOwnershipAcceptance: false,
  safeAddress: null,
};

function createService(
  before: { keywordMarketEnabled: boolean; keywordMarketRequireReview: boolean } | null,
  settings: { keywordMarketEnabled: boolean; keywordMarketRequireReview: boolean },
) {
  const projectId = '00000000-0000-4000-8000-000000000099';
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: projectId }]),
    communitySettings: {
      findUnique: vi.fn().mockResolvedValue(before),
      upsert: vi.fn().mockResolvedValue(settings),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: projectId }) },
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  };
  const service = new ApplicationFeaturesService(prisma as unknown as PrismaService);
  return { projectId, transaction, prisma, service };
}

describe('ApplicationFeaturesService', () => {
  it('fails closed when project settings do not exist', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ApplicationFeaturesService({
      communitySettings: { findFirst },
    } as unknown as PrismaService);

    await expect(service.get()).resolves.toEqual({
      keywordMarketEnabled: false,
      keywordMarketRequireReview: true,
    });
  });

  it('reads both saved settings including disabled review', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      keywordMarketEnabled: true,
      keywordMarketRequireReview: false,
    });
    const prisma = { communitySettings: { findFirst } };
    const service = new ApplicationFeaturesService(prisma as unknown as PrismaService);

    await expect(service.get()).resolves.toEqual({
      keywordMarketEnabled: true,
      keywordMarketRequireReview: false,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { project: { slug: 'precommunity' } },
      select: { keywordMarketEnabled: true, keywordMarketRequireReview: true },
    });
  });

  it.each([true, false])('updates availability to %s without changing review', async (enabled) => {
    const { projectId, transaction, prisma, service } = createService(
      { keywordMarketEnabled: !enabled, keywordMarketRequireReview: false },
      { keywordMarketEnabled: enabled, keywordMarketRequireReview: false },
    );

    await expect(service.updateKeywordMarket(enabled, actor)).resolves.toEqual({
      keywordMarketEnabled: enabled,
      keywordMarketRequireReview: false,
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transaction.communitySettings.upsert).toHaveBeenCalledWith({
      where: { projectId },
      update: { keywordMarketEnabled: enabled, updatedBy: actor.address },
      create: { projectId, keywordMarketEnabled: enabled, updatedBy: actor.address },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'UPDATE_KEYWORD_MARKET_AVAILABILITY',
        actorAddress: actor.address,
        before: { keywordMarketEnabled: !enabled },
        after: { keywordMarketEnabled: enabled },
      }),
    });
  });

  it.each([true, false])(
    'updates review to %s without changing availability',
    async (requireReview) => {
      const { projectId, transaction, prisma, service } = createService(
        { keywordMarketEnabled: !requireReview, keywordMarketRequireReview: !requireReview },
        { keywordMarketEnabled: !requireReview, keywordMarketRequireReview: requireReview },
      );

      await expect(service.updateKeywordMarketReview(requireReview, actor)).resolves.toEqual({
        keywordMarketEnabled: !requireReview,
        keywordMarketRequireReview: requireReview,
      });
      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(transaction.communitySettings.upsert).toHaveBeenCalledWith({
        where: { projectId },
        update: { keywordMarketRequireReview: requireReview, updatedBy: actor.address },
        create: { projectId, keywordMarketRequireReview: requireReview, updatedBy: actor.address },
      });
      expect(transaction.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE_KEYWORD_MARKET_REVIEW_REQUIREMENT',
          actorAddress: actor.address,
          before: { keywordMarketRequireReview: !requireReview },
          after: { keywordMarketRequireReview: requireReview },
        }),
      });
    },
  );

  it('audits the default review requirement when creating settings', async () => {
    const { transaction, service } = createService(null, {
      keywordMarketEnabled: false,
      keywordMarketRequireReview: false,
    });

    await service.updateKeywordMarketReview(false, actor);

    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        before: { keywordMarketRequireReview: true },
        after: { keywordMarketRequireReview: false },
      }),
    });
  });

  it('rejects a review change when its audit write fails', async () => {
    const { transaction, service } = createService(
      { keywordMarketEnabled: true, keywordMarketRequireReview: true },
      { keywordMarketEnabled: true, keywordMarketRequireReview: false },
    );
    transaction.auditEvent.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.updateKeywordMarketReview(false, actor)).rejects.toThrow(
      'audit unavailable',
    );
  });
});
