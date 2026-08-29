import { describe, expect, it, vi } from 'vitest';
import { flushAdResolutionMetrics, retainAdsData } from './ads-maintenance';

describe('PRE Keyword Market metric flushing', () => {
  it('rolls the active Redis hash and persists one exactly-once database batch', async () => {
    const activeKey = 'precommunity:ads:resolutions:2026-08-24';
    let batchKey = '';
    const redis = {
      scan: vi.fn(async (_cursor: string, _match: string, pattern: string) => [
        '0',
        pattern.includes(':flush:*') ? [batchKey] : [activeKey],
      ]),
      eval: vi.fn(async (_script: string, _keys: number, _source: string, target: string) => {
        batchKey = target;
        return 1;
      }),
      hgetall: vi.fn().mockResolvedValue({ 'revision-1': '3', broken: 'not-a-number' }),
      del: vi.fn().mockResolvedValue(1),
    };
    const dailyUpsert = vi.fn();
    const revisionUpdate = vi.fn();
    const tx = {
      adMetricFlush: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      adCreativeRevision: {
        findUnique: vi.fn().mockResolvedValue({ id: 'revision-1' }),
        update: revisionUpdate,
      },
      adDailyMetric: { upsert: dailyUpsert },
    };
    const prisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };

    await expect(flushAdResolutionMetrics(prisma as never, redis as never)).resolves.toEqual({
      batches: 1,
      applied: 1,
      resolutions: '3',
    });
    expect(dailyUpsert).toHaveBeenCalledWith({
      where: {
        revisionId_day: { revisionId: 'revision-1', day: new Date('2026-08-24T00:00:00.000Z') },
      },
      update: { resolutions: { increment: 3n } },
      create: {
        revisionId: 'revision-1',
        day: new Date('2026-08-24T00:00:00.000Z'),
        resolutions: 3n,
      },
    });
    expect(revisionUpdate).toHaveBeenCalledWith({
      where: { id: 'revision-1' },
      data: { lifetimeResolutions: { increment: 3n } },
    });
    expect(redis.del).toHaveBeenCalledWith(batchKey);
  });

  it('does not apply a batch whose database receipt already exists', async () => {
    const batchKey = 'precommunity:ads:resolutions:2026-08-24:flush:retry';
    let scans = 0;
    const redis = {
      scan: vi.fn(async () => ['0', scans++ === 0 ? [] : [batchKey]]),
      eval: vi.fn(),
      hgetall: vi.fn().mockResolvedValue({ 'revision-1': '7' }),
      del: vi.fn().mockResolvedValue(1),
    };
    const tx = {
      adMetricFlush: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      adCreativeRevision: { findUnique: vi.fn(), update: vi.fn() },
      adDailyMetric: { upsert: vi.fn() },
    };
    const prisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };

    const result = await flushAdResolutionMetrics(prisma as never, redis as never);

    expect(result).toMatchObject({ batches: 1, applied: 0 });
    expect(tx.adDailyMetric.upsert).not.toHaveBeenCalled();
    expect(tx.adCreativeRevision.update).not.toHaveBeenCalled();
  });
});

describe('PRE Keyword Market retention', () => {
  it('removes only resolved report detail and daily data older than twelve months', async () => {
    const reportDelete = vi.fn().mockResolvedValue({ count: 2 });
    const metricDelete = vi.fn().mockResolvedValue({ count: 4 });
    const receiptDelete = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      adReport: { deleteMany: reportDelete },
      adDailyMetric: { deleteMany: metricDelete },
      adMetricFlush: { deleteMany: receiptDelete },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };

    await expect(
      retainAdsData(prisma as never, new Date('2026-08-24T00:00:00.000Z')),
    ).resolves.toEqual({ reports: 2, dailyMetrics: 4, metricFlushReceipts: 1 });
    expect(reportDelete).toHaveBeenCalledWith({
      where: {
        status: { not: 'OPEN' },
        resolvedAt: { lt: new Date('2025-08-24T00:00:00.000Z') },
      },
    });
  });
});
