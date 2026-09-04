import type { Queue } from 'bullmq';

export async function scheduleJobs(
  queue: Pick<Queue, 'add'>,
  safeQueue: Pick<Queue, 'add' | 'removeRepeatable'>,
) {
  await safeQueue.removeRepeatable(
    'sync-safe-goal-managers',
    { every: 30_000 },
    'sync-safe-goal-managers',
  );
  const jobs = [
    [queue, 'index-escrow', 15_000],
    [queue, 'reconcile-escrow', 5 * 60_000],
    [queue, 'refresh-metadata', 5 * 60_000],
    [queue, 'index-ads', 15_000],
    [queue, 'flush-ad-metrics', 60_000],
    [queue, 'retain-ads-data', 24 * 60 * 60_000],
    [safeQueue, 'sync-safe-payouts', 30_000],
    [safeQueue, 'sync-safe-goal-actions', 30_000],
  ] as const;
  for (const [target, name, every] of jobs) {
    await target.add(
      name,
      {},
      { repeat: { every }, jobId: name, removeOnComplete: 20, removeOnFail: 100 },
    );
  }
}
