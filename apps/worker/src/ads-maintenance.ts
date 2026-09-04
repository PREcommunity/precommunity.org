import { AdReportStatus, type PrismaClient } from '@precommunity/database';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const ACTIVE_COUNTER_PATTERN = 'precommunity:ads:resolutions:*';
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

async function rollActiveCounters(redis: Redis) {
  const activeKeys = (await scanKeys(redis, ACTIVE_COUNTER_PATTERN)).filter(
    (key) => !key.includes(FLUSH_MARKER),
  );
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

function dayFromBatchKey(key: string) {
  const match = /^precommunity:ads:resolutions:(\d{4}-\d{2}-\d{2}):flush:/.exec(key);
  return match ? new Date(`${match[1]}T00:00:00.000Z`) : null;
}

async function persistBatch(prisma: PrismaClient, redis: Redis, batchKey: string) {
  const day = dayFromBatchKey(batchKey);
  if (!day) {
    await redis.del(batchKey);
    return { batchKey, applied: false, discarded: true, resolutions: 0n };
  }
  const counters = await redis.hgetall(batchKey);
  let total = 0n;
  const entries = Object.entries(counters).flatMap(([revisionId, value]) => {
    try {
      const resolutions = BigInt(value);
      if (resolutions <= 0n) return [];
      total += resolutions;
      return [{ revisionId, resolutions }];
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
      await tx.adDailyMetric.upsert({
        where: { revisionId_day: { revisionId: entry.revisionId, day } },
        update: { resolutions: { increment: entry.resolutions } },
        create: { revisionId: entry.revisionId, day, resolutions: entry.resolutions },
      });
      await tx.adCreativeRevision.update({
        where: { id: entry.revisionId },
        data: { lifetimeResolutions: { increment: entry.resolutions } },
      });
    }
    return true;
  });
  await redis.del(batchKey);
  return { batchKey, applied, discarded: false, resolutions: total };
}

/** Atomically rolls Redis hashes and persists each batch exactly once. */
export async function flushAdResolutionMetrics(prisma: PrismaClient, redis: Redis) {
  await rollActiveCounters(redis);
  const batches = await scanKeys(redis, `${ACTIVE_COUNTER_PATTERN}${FLUSH_MARKER}*`);
  const results = [];
  for (const batch of batches) results.push(await persistBatch(prisma, redis, batch));
  return {
    batches: results.length,
    applied: results.filter((result) => result.applied).length,
    resolutions: results.reduce((sum, result) => sum + result.resolutions, 0n).toString(),
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
