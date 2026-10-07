import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdsMetricsService } from './ads-metrics.service';

const mocks = vi.hoisted(() => {
  const pipeline = {
    hincrby: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(),
  };
  return {
    pipeline,
    redis: {
      status: 'ready',
      connect: vi.fn(),
      on: vi.fn(),
      multi: vi.fn(() => pipeline),
      quit: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});
vi.mock('ioredis', () => ({
  default: class {
    constructor() {
      return mocks.redis;
    }
  },
}));

describe('best-effort ad analytics counters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redis.status = 'ready';
    mocks.pipeline.exec.mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);
  });

  it.each([
    ['increment', 'resolutions'],
    ['incrementView', 'views'],
    ['incrementClick', 'clicks'],
  ] as const)('writes %s to its UTC daily bucket', async (method, type) => {
    const service = new AdsMetricsService();
    await expect(
      service[method]('revision-1', new Date('2026-10-07T01:00:00+02:00')),
    ).resolves.toBe(true);
    expect(mocks.pipeline.hincrby).toHaveBeenCalledWith(
      `precommunity:ads:${type}:2026-10-06`,
      'revision-1',
      1,
    );
    expect(mocks.pipeline.expire).toHaveBeenCalledWith(
      `precommunity:ads:${type}:2026-10-06`,
      14 * 24 * 60 * 60,
    );
  });

  it('does not throw or enqueue events while Redis is unavailable', async () => {
    mocks.redis.status = 'reconnecting';
    await expect(new AdsMetricsService().incrementClick('revision-1')).resolves.toBe(false);
    expect(mocks.redis.multi).not.toHaveBeenCalled();
    mocks.redis.status = 'wait';
    mocks.redis.connect.mockRejectedValue(new Error('unavailable'));
    await expect(new AdsMetricsService().incrementView('revision-1')).resolves.toBe(false);
  });

  it('shares the initial connection so a simultaneous resolution and view are both counted', async () => {
    let finishConnection!: () => void;
    mocks.redis.status = 'wait';
    mocks.redis.connect.mockImplementationOnce(() => {
      mocks.redis.status = 'connecting';
      return new Promise<void>((resolve) => {
        finishConnection = () => {
          mocks.redis.status = 'ready';
          resolve();
        };
      });
    });
    const service = new AdsMetricsService();
    const resolution = service.increment('revision-1');
    const view = service.incrementView('revision-1');
    finishConnection();
    await expect(Promise.all([resolution, view])).resolves.toEqual([true, true]);
    expect(mocks.redis.connect).toHaveBeenCalledOnce();
    expect(mocks.pipeline.hincrby).toHaveBeenCalledTimes(2);
  });

  it('treats Redis command and transaction errors as failed optional metrics', async () => {
    const service = new AdsMetricsService();
    mocks.pipeline.exec.mockRejectedValueOnce(new Error('command failed'));
    await expect(service.incrementClick('revision-1')).resolves.toBe(false);
    mocks.pipeline.exec.mockResolvedValueOnce([
      [new Error('increment failed'), null],
      [null, 1],
    ]);
    await expect(service.incrementClick('revision-1')).resolves.toBe(false);
  });
});
