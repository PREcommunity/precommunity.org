import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { adMetricCounterKey, adsUtcDay } from '@precommunity/shared';
import Redis from 'ioredis';
import { config } from '../config';

const COUNTER_TTL_SECONDS = 14 * 24 * 60 * 60;

@Injectable()
export class AdsMetricsService implements OnModuleDestroy {
  private connecting: Promise<void> | null = null;
  private readonly redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 500,
    commandTimeout: 500,
  });

  constructor() {
    // Analytics are best-effort and must never prevent ad delivery or redirects.
    this.redis.on('error', () => undefined);
  }

  increment(revisionId: string, date = new Date()) {
    return this.incrementCounter('resolutions', revisionId, date);
  }

  incrementView(revisionId: string, date = new Date()) {
    return this.incrementCounter('views', revisionId, date);
  }

  incrementClick(revisionId: string, date = new Date()) {
    return this.incrementCounter('clicks', revisionId, date);
  }

  private async incrementCounter(
    type: 'resolutions' | 'views' | 'clicks',
    revisionId: string,
    date: Date,
  ) {
    try {
      if (this.redis.status === 'wait' && !this.connecting) {
        this.connecting = this.redis.connect().finally(() => {
          this.connecting = null;
        });
      }
      if (this.connecting) await this.connecting;
      if (this.redis.status !== 'ready') return false;
      const key = adMetricCounterKey(type, adsUtcDay(date));
      const result = await this.redis
        .multi()
        .hincrby(key, revisionId, 1)
        .expire(key, COUNTER_TTL_SECONDS)
        .exec();
      return result?.every(([error]) => error === null) ?? false;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
