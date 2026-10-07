import { AdReportStatus, type PrismaClient } from '@precommunity/database';
import { adMetricCounterKey } from '@precommunity/shared';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const metricTypes = ['resolutions', 'views', 'clicks'] as const;
type MetricType = (typeof metricTypes)[number];
const lifetimeField = {
  resolutions: 'lifetimeResolutions',
  views: 'lifetimeViews',
  clicks: 'lifetimeClicks',
} as const;
const FLUSH_MARKER = ':flush:';
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

async function scanKeys(redis: Redis, pattern: string) {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, page] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...page);
  } while (cursor !== '0');
  return keys;
}

async function rollActiveCounters(redis: Redis, pattern: string) {
  const activeKeys = (await scanKeys(redis, pattern)).filter((key) => !key.includes(FLUSH_MARKER));
  const batches: string[] = [];
  for (const activeKey of activeKeys) {
    const batchKey = `${activeKey}${FLUSH_MARKER}${randomUUID()}`;
    const moved = await redis.eval(
      "if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('RENAME', KEYS[1], KEYS[2]); return 1 else return 0 end",
      2,
      activeKey,
      batchKey,
    );
    if (Number(moved) === 1) batches.push(batchKey);
  }
  return batches;
}

function bucketFromBatchKey(key: string) {
  const match = /^precommunity:ads:(resolutions|views|clicks):(\d{4}-\d{2}-\d{2}):flush:/.exec(key);
  return match
    ? { type: match[1] as MetricType, day: new Date(`${match[2]}T00:00:00.000Z`) }
    : null;
}

async function persistBatch(prisma: PrismaClient, redis: Redis, batchKey: string) {
  const bucket = bucketFromBatchKey(batchKey);
  if (!bucket || Number.isNaN(bucket.day.getTime())) {
    await redis.del(batchKey);
    return { batchKey, applied: false, type: null, total: 0n };
  }
  const { day, type } = bucket;
  const counters = await redis.hgetall(batchKey);
  let total = 0n;
  const entries = Object.entries(counters).flatMap(([revisionId, value]) => {
    try {
      const count = BigInt(value);
      if (count <= 0n) return [];
      return [{ revisionId, count }];
    } catch {
      return [];
    }
  });
  const applied = await prisma.$transaction(async (tx) => {
    const receipt = await tx.adMetricFlush.createMany({
      data: [{ id: batchKey, bucketDay: day }],
      skipDuplicates: true,
    });
    if (receipt.count !== 1) return false;
    for (const entry of entries) {
      const revision = await tx.adCreativeRevision.findUnique({
        where: { id: entry.revisionId },
        select: { id: true },
      });
      if (!revision) continue;
      total += entry.count;
      await tx.adDailyMetric.upsert({
        where: { revisionId_day: { revisionId: entry.revisionId, day } },
        update: { [type]: { increment: entry.count } },
        create: { revisionId: entry.revisionId, day, [type]: entry.count },
      });
      await tx.adCreativeRevision.update({
        where: { id: entry.revisionId },
        data: { [lifetimeField[type]]: { increment: entry.count } },
      });
    }
    return true;
  });
  await redis.del(batchKey);
  return { batchKey, applied, type, total };
}

/** Atomically rolls Redis hashes and persists each batch exactly once. */
export async function flushAdResolutionMetrics(prisma: PrismaClient, redis: Redis) {
  const results = [];
  for (const type of metricTypes) {
    const pattern = adMetricCounterKey(type, '*');
    await rollActiveCounters(redis, pattern);
    const batches = await scanKeys(redis, `${pattern}${FLUSH_MARKER}*`);
    for (const batch of batches) results.push(await persistBatch(prisma, redis, batch));
  }
  const totals = { resolutions: 0n, views: 0n, clicks: 0n };
  for (const result of results) {
    if (result.applied && result.type) totals[result.type] += result.total;
  }
  return {
    batches: results.length,
    applied: results.filter((result) => result.applied).length,
    resolutions: totals.resolutions.toString(),
    views: totals.views.toString(),
    clicks: totals.clicks.toString(),
  };
}

export async function retainAdsData(prisma: PrismaClient, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const [reports, metrics, flushReceipts] = await prisma.$transaction([
    prisma.adReport.deleteMany({
      where: {
        status: { not: AdReportStatus.OPEN },
        resolvedAt: { lt: cutoff },
      },
    }),
    prisma.adDailyMetric.deleteMany({ where: { day: { lt: cutoff } } }),
    prisma.adMetricFlush.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  return {
    reports: reports.count,
    dailyMetrics: metrics.count,
    metricFlushReceipts: flushReceipts.count,
  };
}
