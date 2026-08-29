import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { adResolutionCounterKey, adsUtcDay } from '@precommunity/shared';
import Redis from 'ioredis';
import { config } from '../config';

const COUNTER_TTL_SECONDS = 14 * 24 * 60 * 60;

@Injectable()
export class AdsMetricsService implements OnModuleDestroy {
  private readonly redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  constructor() {
    // Resolution metrics are deliberately best-effort and must never make the API unhealthy.
    this.redis.on('error', () => undefined);
  }

  async increment(revisionId: string, date = new Date()) {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      if (this.redis.status !== 'ready') return false;
      const key = adResolutionCounterKey(adsUtcDay(date));
      await this.redis.multi().hincrby(key, revisionId, 1).expire(key, COUNTER_TTL_SECONDS).exec();
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
