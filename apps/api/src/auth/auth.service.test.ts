import type { PrismaService } from '../common/prisma.service';
import { ChainAuthorityKind, Role } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { AuthService, effectiveRoles } from './auth.service';
import { config } from '../config';
import type { SafeService } from '../safe/safe.service';

describe('effective on-chain roles', () => {
  it('derives root authority only from the confirmed owner projection', () => {
    expect(effectiveRoles([Role.SUPER_ADMIN, Role.CONTENT_ADMIN], [])).toEqual([
      Role.CONTENT_ADMIN,
    ]);
    expect(effectiveRoles([], [ChainAuthorityKind.OWNER])).toEqual([Role.SUPER_ADMIN]);
  });

  it('maps a confirmed goal manager to contract-operation capabilities', () => {
    expect(effectiveRoles([], [ChainAuthorityKind.GOAL_MANAGER])).toEqual([
      Role.CONTENT_ADMIN,
      Role.FINANCE_ADMIN,
    ]);
  });

  it('maps a confirmed Safe owner to root portal access without direct chain authority', () => {
    expect(effectiveRoles([], [], true)).toEqual([Role.SUPER_ADMIN]);
  });
});

describe('AuthService challenges', () => {
  it('does not create a user before a wallet signature is verified', async () => {
    const prisma = {
      user: { upsert: vi.fn() },
      walletSession: { deleteMany: vi.fn(), create: vi.fn() },
    } as unknown as PrismaService;
    const service = new AuthService(prisma);

    await service.createNonce('0x0000000000000000000000000000000000000001');

    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(prisma.walletSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ userId: expect.anything() }),
      }),
    );
  });

  it('binds a challenge to the configured application origin', async () => {
    const create = vi.fn();
    const prisma = {
      walletSession: { deleteMany: vi.fn(), create },
    } as unknown as PrismaService;
    const service = new AuthService(prisma);

    const challenge = await service.createNonce(
      '0x0000000000000000000000000000000000000001',
      config.WEB_ORIGIN,
    );

    expect(challenge).toMatchObject({
      domain: config.SIWE_DOMAIN,
      uri: config.SIWE_URI,
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siweDomain: config.SIWE_DOMAIN,
        siweUri: config.SIWE_URI,
      }),
    });
  });

  it('rejects challenges requested from another origin', async () => {
    const prisma = {
      walletSession: { deleteMany: vi.fn(), create: vi.fn() },
    } as unknown as PrismaService;
    const service = new AuthService(prisma);

    await expect(
      service.createNonce('0x0000000000000000000000000000000000000001', 'https://example.com'),
    ).rejects.toThrow('This origin cannot request a wallet session');
  });
});

describe('AuthService portal access', () => {
  it('exposes ownership acceptance without granting root access before the Safe takeover', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const safeAddress = '0x2222222222222222222222222222222222222222';
    const currentOwner = '0x3333333333333333333333333333333333333333';
    const prisma = {
      walletSession: {
        findUnique: vi.fn().mockResolvedValue({
          user: { id: 'user-1', address, roles: [] },
          sessionExpiresAt: new Date(Date.now() + 60_000),
        }),
      },
      chainAuthority: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ address: currentOwner, kind: ChainAuthorityKind.OWNER }]),
      },
    } as unknown as PrismaService;
    const safe = {
      configuredAddress: vi.fn().mockReturnValue(safeAddress),
      runtimeInfo: vi.fn().mockResolvedValue({
        owners: [address],
        isPendingEscrowOwner: true,
      }),
    } as unknown as SafeService;
    const service = new AuthService(prisma, safe);

    await expect(service.authenticate('session-token')).resolves.toMatchObject({
      roles: [],
      safeOwner: false,
      canAccessSafeOwnershipAcceptance: true,
    });
  });
});
