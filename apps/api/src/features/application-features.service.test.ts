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

describe('ApplicationFeaturesService', () => {
  it('fails closed when project settings do not exist', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ApplicationFeaturesService({
      communitySettings: { findFirst },
    } as unknown as PrismaService);

    await expect(service.get()).resolves.toEqual({ keywordMarketEnabled: false });
  });

  it('updates the flag and records the transition atomically', async () => {
    const projectId = '00000000-0000-4000-8000-000000000099';
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: projectId }]),
      communitySettings: {
        findUnique: vi.fn().mockResolvedValue({ keywordMarketEnabled: false }),
        upsert: vi.fn().mockResolvedValue({ keywordMarketEnabled: true }),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: projectId }) },
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new ApplicationFeaturesService(prisma as unknown as PrismaService);

    await expect(service.updateKeywordMarket(true, actor)).resolves.toEqual({
      keywordMarketEnabled: true,
    });
    expect(transaction.communitySettings.upsert).toHaveBeenCalledWith({
      where: { projectId },
      update: { keywordMarketEnabled: true, updatedBy: actor.address },
      create: { projectId, keywordMarketEnabled: true, updatedBy: actor.address },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'UPDATE_KEYWORD_MARKET_AVAILABILITY',
        actorAddress: actor.address,
        before: { keywordMarketEnabled: false },
        after: { keywordMarketEnabled: true },
      }),
    });
  });
});
