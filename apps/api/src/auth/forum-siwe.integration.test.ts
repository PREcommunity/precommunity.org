import { UnauthorizedException } from '@nestjs/common';
import { SiweMessage } from 'siwe';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../common/request-context';
import { ForumController } from '../community/forum.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';

function executionContext(request: AuthenticatedRequest) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

function authDatabase(address: string) {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    address: address.toLowerCase(),
    roles: [],
  };
  let session: Record<string, any> | null = null;
  const prisma: Record<string, any> = {
    walletSession: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        session = {
          id: '00000000-0000-4000-8000-000000000002',
          userId: null,
          nonceUsedAt: null,
          sessionTokenHash: null,
          sessionExpiresAt: null,
          createdAt: new Date(),
          ...data,
        };
        return session;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (
          !session ||
          session.address !== where.address ||
          session.nonceHash !== where.nonceHash ||
          session.nonceUsedAt
        )
          return null;
        return { ...session };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (!session || session.id !== where.id || session.nonceUsedAt) return { count: 0 };
          Object.assign(session, data);
          return { count: 1 };
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (!session || session.sessionTokenHash !== where.sessionTokenHash) return null;
        return { ...session, user };
      }),
    },
    user: { upsert: vi.fn().mockResolvedValue(user) },
    chainAuthority: { findMany: vi.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = vi.fn(async (callback: (database: typeof prisma) => unknown) =>
    callback(prisma),
  );
  return prisma;
}

describe('forum SIWE boundary', () => {
  it('verifies a wallet signature, creates a session and passes its principal to a protected forum mutation', async () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}` as `0x${string}`);
    const auth = new AuthService(authDatabase(account.address) as never);
    const challenge = await auth.createNonce(account.address);
    const message = new SiweMessage({
      domain: challenge.domain,
      address: account.address,
      statement: 'Sign in to precommunity.',
      uri: challenge.uri,
      version: '1',
      chainId: challenge.chainId,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    }).prepareMessage();
    const signature = await account.signMessage({ message });

    const verified = await auth.verify(message, signature);
    const request = {
      cookies: { precommunity_session: verified.sessionToken },
    } as unknown as AuthenticatedRequest;
    await new SessionGuard(auth).canActivate(executionContext(request));

    const create = vi.fn().mockResolvedValue({ id: 'topic-1' });
    const controller = new ForumController({ create } as never);
    const input = {
      title: 'Signed community topic',
      body: 'This mutation is backed by a verified SIWE session.',
      category: 'GENERAL',
    };
    await controller.create(input, request);

    expect(request.principal).toMatchObject({
      address: account.address.toLowerCase(),
      userId: '00000000-0000-4000-8000-000000000001',
    });
    expect(create).toHaveBeenCalledWith(input, request.principal);
    await expect(auth.verify(message, signature)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns an authentication error for a signature from a different wallet without consuming the nonce', async () => {
    const account = privateKeyToAccount(`0x${'22'.repeat(32)}` as `0x${string}`);
    const otherAccount = privateKeyToAccount(`0x${'33'.repeat(32)}` as `0x${string}`);
    const auth = new AuthService(authDatabase(account.address) as never);
    const challenge = await auth.createNonce(account.address);
    const message = new SiweMessage({
      domain: challenge.domain,
      address: account.address,
      statement: 'Sign in to precommunity.',
      uri: challenge.uri,
      version: '1',
      chainId: challenge.chainId,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    }).prepareMessage();

    const invalidSignature = await otherAccount.signMessage({ message });
    await expect(auth.verify(message, invalidSignature)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const validSignature = await account.signMessage({ message });
    await expect(auth.verify(message, validSignature)).resolves.toMatchObject({
      user: { address: account.address.toLowerCase() },
    });
  });
});
