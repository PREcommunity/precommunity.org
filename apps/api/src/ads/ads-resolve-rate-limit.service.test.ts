import { Logger } from '@nestjs/common';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdsResolveRateLimitService } from './ads-resolve-rate-limit.service';

const mocks = vi.hoisted(() => ({
  redis: {
    status: 'ready',
    on: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
  constructor: vi.fn(),
  limiterConstructor: vi.fn(),
  consume: vi.fn(),
}));
vi.mock('../config', () => ({
  config: { REDIS_URL: 'redis://rate-limit.example:6379', deployment: { chainId: 84532 } },
}));
vi.mock('ioredis', () => ({
  default: class {
    constructor(...args: unknown[]) {
      mocks.constructor(...args);
      return mocks.redis;
    }
  },
}));
vi.mock('rate-limiter-flexible', async (original) => ({
  ...(await original<typeof import('rate-limiter-flexible')>()),
  RateLimiterRedis: class {
    constructor(...args: unknown[]) {
      mocks.limiterConstructor(...args);
      return { consume: mocks.consume };
    }
  },
}));

const keyHash = 'a'.repeat(64);

describe('shared resolver rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
    mocks.redis.status = 'ready';
    mocks.redis.connect.mockReset();
    mocks.consume.mockReset().mockResolvedValue({});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the library fixed window of sixty requests per second for each hashed key', async () => {
    const service = new AdsResolveRateLimitService();
    await expect(service.consume(keyHash)).resolves.toBe(0);
    expect(mocks.consume).toHaveBeenCalledWith(keyHash);
    expect(mocks.limiterConstructor).toHaveBeenCalledWith({
      storeClient: mocks.redis,
      points: 60,
      duration: 1,
      keyPrefix: 'precommunity:ads:resolve:limit:v2:84532',
    });
    expect(mocks.constructor).toHaveBeenCalledWith('redis://rate-limit.example:6379', {
      lazyConnect: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      commandTimeout: 500,
      socketTimeout: 500,
    });
  });

  it.each([0, 17, 1_000])(
    'returns the rejected limit retry delay of %dms without warning',
    async (delay) => {
      mocks.consume.mockRejectedValue(new RateLimiterRes(0, delay, 61));
      await expect(new AdsResolveRateLimitService().consume(keyHash)).resolves.toBe(
        Math.max(1, delay),
      );
      expect(Logger.prototype.warn).not.toHaveBeenCalled();
    },
  );

  it('shares the initial connection across concurrent requests', async () => {
    let finishConnection!: () => void;
    mocks.redis.status = 'wait';
    mocks.redis.connect.mockImplementation(() => {
      mocks.redis.status = 'connecting';
      return new Promise<void>((resolve) => {
        finishConnection = () => {
          mocks.redis.status = 'ready';
          resolve();
        };
      });
    });
    const service = new AdsResolveRateLimitService();
    const requests = [service.consume(keyHash), service.consume('b'.repeat(64))];
    finishConnection();
    await expect(Promise.all(requests)).resolves.toEqual([0, 0]);
    expect(mocks.redis.connect).toHaveBeenCalledOnce();
    expect(mocks.consume).toHaveBeenCalledTimes(2);
  });

  it.each(['reconnecting', 'end'])(
    'fails open while Redis is %s without issuing commands',
    async (status) => {
      mocks.redis.status = status;
      await expect(new AdsResolveRateLimitService().consume(keyHash)).resolves.toBe(0);
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledOnce();
    },
  );

  it('fails open after an initial connection error', async () => {
    mocks.redis.status = 'wait';
    mocks.redis.connect.mockRejectedValue(new Error('private Redis credentials'));
    await expect(new AdsResolveRateLimitService().consume(keyHash)).resolves.toBe(0);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(Logger.prototype.warn).mock.calls)).not.toContain(
      'credentials',
    );
  });

  it('fails open on command errors and warns at most once per minute per instance', async () => {
    const service = new AdsResolveRateLimitService();
    mocks.consume.mockRejectedValue(new Error(`private Redis credentials ${keyHash}`));
    await expect(service.consume(keyHash)).resolves.toBe(0);
    await expect(service.consume(keyHash)).resolves.toBe(0);
    await vi.advanceTimersByTimeAsync(59_999);
    await expect(service.consume(keyHash)).resolves.toBe(0);
    expect(Logger.prototype.warn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(service.consume(keyHash)).resolves.toBe(0);
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(2);
    const warnings = JSON.stringify(vi.mocked(Logger.prototype.warn).mock.calls);
    expect(warnings).not.toContain('credentials');
    expect(warnings).not.toContain(keyHash);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'fails open on an invalid limit rejection delay %j',
    async (result) => {
      mocks.consume.mockRejectedValue(new RateLimiterRes(0, result, 61));
      await expect(new AdsResolveRateLimitService().consume(keyHash)).resolves.toBe(0);
      expect(Logger.prototype.warn).toHaveBeenCalledOnce();
    },
  );

  it('fails open within 500ms if a command never finishes', async () => {
    mocks.consume.mockReturnValue(new Promise(() => undefined));
    const request = new AdsResolveRateLimitService().consume(keyHash);
    await vi.advanceTimersByTimeAsync(500);
    await expect(request).resolves.toBe(0);
    expect(mocks.consume).toHaveBeenCalledOnce();
  });

  it('does not issue a late consume after its connection deadline has passed', async () => {
    let finishConnection!: () => void;
    mocks.redis.status = 'wait';
    mocks.redis.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishConnection = () => {
            mocks.redis.status = 'ready';
            resolve();
          };
        }),
    );
    const request = new AdsResolveRateLimitService().consume(keyHash);
    await vi.advanceTimersByTimeAsync(500);
    await expect(request).resolves.toBe(0);
    finishConnection();
    await Promise.resolve();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('uses the same shared window across service instances and closes its connection', async () => {
    const first = new AdsResolveRateLimitService();
    const second = new AdsResolveRateLimitService();
    await first.consume(keyHash);
    await second.consume(keyHash);
    expect(mocks.consume).toHaveBeenNthCalledWith(1, keyHash);
    expect(mocks.consume).toHaveBeenNthCalledWith(2, keyHash);
    expect(mocks.limiterConstructor.mock.calls[0]?.[0].keyPrefix).toBe(
      mocks.limiterConstructor.mock.calls[1]?.[0].keyPrefix,
    );
    first.onModuleDestroy();
    expect(mocks.redis.disconnect).toHaveBeenCalledOnce();
  });
});
