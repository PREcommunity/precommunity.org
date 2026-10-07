import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service';

export function hashAdApiKey(apiKey: string) {
  return createHash('sha256').update(apiKey).digest('hex');
}

@Injectable()
export class AdsApiKeyGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const apiKey = context.switchToHttp().getRequest<Request>().headers['x-api-key'];
    if (typeof apiKey !== 'string' || !/^pkm_[A-Za-z0-9_-]{43}$/.test(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
    let count: number;
    try {
      ({ count } = await this.prisma.adApiKey.updateMany({
        where: { keyHash: hashAdApiKey(apiKey), revokedAt: null },
        data: { lastUsedAt: new Date() },
      }));
    } catch {
      throw new ServiceUnavailableException('API key authentication is unavailable');
    }
    if (count !== 1) throw new UnauthorizedException('Invalid API key');
    return true;
  }
}
