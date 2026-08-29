import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ChainAuthorityKind, Role } from '@precommunity/database';
import { randomBytes, createHash } from 'node:crypto';
import { generateNonce, SiweMessage } from 'siwe';
import { getAddress } from 'viem';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { SafeService } from '../safe/safe.service';

const NONCE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const contractAddress = config.deployment.escrowAddress.toLowerCase();
const roleOrder = [Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN] as const;
const siweScope = {
  origin: new URL(config.WEB_ORIGIN).origin,
  domain: config.SIWE_DOMAIN,
  uri: config.SIWE_URI,
} as const;

export function effectiveRoles(
  databaseRoles: Role[],
  authorities: ChainAuthorityKind[],
  confirmedSafeOwner = false,
) {
  // Root authority is never accepted from PostgreSQL. It follows the confirmed
  // Ownable owner projection, so an ownership transfer revokes it automatically.
  const roles = new Set<Role>(databaseRoles.filter((role) => role !== Role.SUPER_ADMIN));
  if (authorities.includes(ChainAuthorityKind.OWNER) || confirmedSafeOwner) {
    roles.add(Role.SUPER_ADMIN);
  }
  if (authorities.includes(ChainAuthorityKind.GOAL_MANAGER)) {
    roles.add(Role.CONTENT_ADMIN);
    roles.add(Role.FINANCE_ADMIN);
  }
  return roleOrder.filter((role) => roles.has(role));
}

function digest(value: string) {
  return createHash('sha256').update(`${config.SESSION_SECRET}:${value}`).digest('hex');
}

@Injectable()
export class AuthService {
  private nextCleanupAt = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(SafeService) private readonly safe?: SafeService,
  ) {}

  private async principalFor(user: { id: string; address: string; roles: Role[] }) {
    const address = user.address.toLowerCase();
    const projected = await this.prisma.chainAuthority.findMany({
      where: {
        chainId: config.deployment.chainId,
        contractAddress,
        OR: [{ address }, { kind: ChainAuthorityKind.OWNER }],
      },
      select: { address: true, kind: true },
    });
    const chainAuthorities = projected
      .filter((authority) => authority.address === address)
      .map((authority) => authority.kind);
    const owner = projected.find((authority) => authority.kind === ChainAuthorityKind.OWNER);
    const configuredSafe = this.safe?.configuredAddress()?.toLowerCase();
    const safeIsEscrowOwner = Boolean(
      configuredSafe && owner?.address.toLowerCase() === configuredSafe,
    );
    const safeInfo =
      configuredSafe && this.safe ? await this.safe.runtimeInfo().catch(() => null) : null;
    const isConfiguredSafeOwner =
      safeInfo?.owners.some((safeOwnerAddress) => safeOwnerAddress.toLowerCase() === address) ??
      false;
    const safeOwner = safeIsEscrowOwner && isConfiguredSafeOwner;
    return {
      userId: user.id,
      address,
      roles: effectiveRoles(user.roles, chainAuthorities, safeOwner),
      chainAuthorities,
      chainOwnerAddress: owner?.address ?? null,
      safeOwner,
      canAccessSafeOwnershipAcceptance: Boolean(
        isConfiguredSafeOwner && safeInfo?.isPendingEscrowOwner,
      ),
      safeAddress: configuredSafe ?? null,
    };
  }

  async createNonce(rawAddress: string, requestedOrigin = config.WEB_ORIGIN) {
    const address = getAddress(rawAddress).toLowerCase();
    let origin: string;
    try {
      origin = new URL(requestedOrigin).origin;
    } catch {
      throw new BadRequestException('Unsupported sign-in origin');
    }
    if (origin !== siweScope.origin) {
      throw new UnauthorizedException('This origin cannot request a wallet session');
    }
    await this.cleanupExpiredSessions();
    const nonce = generateNonce();
    await this.prisma.walletSession.create({
      data: {
        address,
        nonceHash: digest(nonce),
        nonceExpiresAt: new Date(Date.now() + NONCE_TTL_MS),
        siweDomain: siweScope.domain,
        siweUri: siweScope.uri,
      },
    });
    return {
      nonce,
      domain: siweScope.domain,
      uri: siweScope.uri,
      chainId: config.BASE_CHAIN_ID,
    };
  }

  async verify(messageValue: string, signature: string) {
    let message: SiweMessage;
    try {
      message = new SiweMessage(messageValue);
    } catch {
      throw new BadRequestException('Malformed SIWE message');
    }

    const address = getAddress(message.address).toLowerCase();
    const challenge = await this.prisma.walletSession.findFirst({
      where: {
        address,
        nonceHash: digest(message.nonce),
        nonceUsedAt: null,
        nonceExpiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new UnauthorizedException('Nonce is expired or has already been used');
    const scopeStillAllowed =
      siweScope.domain === challenge.siweDomain &&
      siweScope.uri === challenge.siweUri &&
      message.domain === siweScope.domain &&
      message.uri === siweScope.uri;
    if (!scopeStillAllowed || message.chainId !== config.BASE_CHAIN_ID) {
      throw new UnauthorizedException('SIWE scope does not match this application');
    }

    const verification = await message.verify(
      { signature, domain: challenge.siweDomain!, nonce: message.nonce },
      { suppressExceptions: true },
    );
    if (!verification.success) throw new UnauthorizedException('Invalid wallet signature');

    const sessionToken = randomBytes(32).toString('base64url');
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const user = await this.prisma.$transaction(async (tx) => {
      const authenticatedUser = await tx.user.upsert({
        where: { address },
        update: {},
        create: { address },
      });
      const claimed = await tx.walletSession.updateMany({
        where: { id: challenge.id, nonceUsedAt: null, nonceExpiresAt: { gt: new Date() } },
        data: {
          userId: authenticatedUser.id,
          nonceUsedAt: new Date(),
          sessionTokenHash: digest(sessionToken),
          sessionExpiresAt,
        },
      });
      if (claimed.count !== 1) throw new UnauthorizedException('Nonce replay rejected');
      return authenticatedUser;
    });

    const principal = await this.principalFor(user);
    return {
      sessionToken,
      sessionExpiresAt,
      user: principal,
    };
  }

  async authenticate(token: string) {
    const session = await this.prisma.walletSession.findUnique({
      where: { sessionTokenHash: digest(token) },
      include: { user: true },
    });
    if (!session?.user || !session.sessionExpiresAt || session.sessionExpiresAt <= new Date()) {
      throw new UnauthorizedException('Session expired');
    }
    return this.principalFor(session.user);
  }

  async logout(token?: string) {
    if (!token) return;
    await this.prisma.walletSession.deleteMany({ where: { sessionTokenHash: digest(token) } });
  }

  private async cleanupExpiredSessions() {
    const now = new Date();
    if (now.getTime() < this.nextCleanupAt) return;
    this.nextCleanupAt = now.getTime() + SESSION_CLEANUP_INTERVAL_MS;
    await this.prisma.walletSession.deleteMany({
      where: {
        OR: [
          { sessionTokenHash: null, nonceExpiresAt: { lte: now } },
          { sessionExpiresAt: { lte: now } },
        ],
      },
    });
  }
}
