import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

const WINDOW_MS = 60_000;
const REQUESTS_PER_CLIENT = 10;
const REQUESTS_PER_ENDPOINT = 60;

type Bucket = { count: number; resetAt: number };

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const endpoint = request.path;
    const client = request.ip || request.socket.remoteAddress || 'unknown';

    if (
      !this.consume(`endpoint:${endpoint}`, REQUESTS_PER_ENDPOINT, now) ||
      !this.consume(`client:${client}:${endpoint}`, REQUESTS_PER_CLIENT, now)
    ) {
      throw new HttpException('Too many authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private consume(key: string, limit: number, now: number) {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      if (this.buckets.size > REQUESTS_PER_ENDPOINT * 3) this.removeExpired(now);
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }

  private removeExpired(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
