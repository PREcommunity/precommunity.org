import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { AdsResolveRateLimitService } from './ads-resolve-rate-limit.service';

const LAST_USED_INTERVAL_MS = 60_000;

export function hashAdApiKey(apiKey: string) {
  return createHash('sha256').update(apiKey).digest('hex');
}

@Injectable()
export class AdsApiKeyGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdsResolveRateLimitService) private readonly rateLimit: AdsResolveRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const apiKey = context.switchToHttp().getRequest<Request>().headers['x-api-key'];
    if (typeof apiKey !== 'string' || !/^pkm_[A-Za-z0-9_-]{43}$/.test(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
    const keyHash = hashAdApiKey(apiKey);
    const retryAfterMs = await this.rateLimit.consume(keyHash);
    if (retryAfterMs > 0) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Retry-After', Math.ceil(retryAfterMs / 1_000).toString());
      throw new HttpException('Too many ad resolver requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    const key = await this.prisma.adApiKey
      .findUnique({
        where: { keyHash },
        select: { id: true, revokedAt: true, lastUsedAt: true },
      })
      .catch(() => {
        throw new ServiceUnavailableException('API key authentication is unavailable');
      });
    if (!key || key.revokedAt) throw new UnauthorizedException('Invalid API key');
    const now = new Date();
    const cutoff = new Date(now.getTime() - LAST_USED_INTERVAL_MS);
    if (!key.lastUsedAt || key.lastUsedAt <= cutoff) {
      // Usage metadata is optional; authorization was checked against the live key above.
      await this.prisma.adApiKey
        .updateMany({
          where: {
            id: key.id,
            revokedAt: null,
            OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: cutoff } }],
          },
          data: { lastUsedAt: now },
        })
        .catch(() => undefined);
    }
    return true;
  }
}
