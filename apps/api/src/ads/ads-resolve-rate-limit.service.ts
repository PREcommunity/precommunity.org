import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { config } from '../config';

const REQUESTS_PER_SECOND = 60;
const DEADLINE_MS = 500;
const WARNING_INTERVAL_MS = 60_000;

@Injectable()
export class AdsResolveRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(AdsResolveRateLimitService.name);
  private connecting: Promise<void> | null = null;
  private lastWarningAt: number | null = null;
  private readonly redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    maxRetriesPerRequest: 0,
    connectTimeout: DEADLINE_MS,
    commandTimeout: DEADLINE_MS,
    socketTimeout: DEADLINE_MS,
  });
  private readonly limiter = new RateLimiterRedis({
    storeClient: this.redis,
    points: REQUESTS_PER_SECOND,
    duration: 1,
    keyPrefix: `precommunity:ads:resolve:limit:v2:${config.deployment.chainId}`,
  });

  constructor() {
    this.redis.on('error', () => undefined);
  }

  async consume(keyHash: string): Promise<number> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Rate limit timed out')), DEADLINE_MS);
      });
      if (this.redis.status === 'wait' && !this.connecting) {
        this.connecting = this.redis.connect().finally(() => {
          this.connecting = null;
        });
      }
      if (this.connecting) await Promise.race([this.connecting, deadline]);
      if (this.redis.status !== 'ready') throw new Error('Rate limit is unavailable');
      await Promise.race([this.limiter.consume(keyHash), deadline]);
      return 0;
    } catch (error) {
      if (
        error instanceof RateLimiterRes &&
        Number.isFinite(error.msBeforeNext) &&
        error.msBeforeNext >= 0
      ) {
        return Math.max(1, error.msBeforeNext);
      }
      const now = Date.now();
      if (this.lastWarningAt === null || now - this.lastWarningAt >= WARNING_INTERVAL_MS) {
        this.lastWarningAt = now;
        this.logger.warn(
          'Resolver rate limiting is unavailable; continuing with live API key authentication',
        );
      }
      return 0;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
