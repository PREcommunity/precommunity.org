import type { Queue } from 'bullmq';
import {
  AD_CHARGE_JOB,
  AD_CHARGE_POLL_MS,
  PRE_USD_PRICE_JOB,
  PRE_USD_PRICE_POLL_MS,
  PRE_USD_PRICE_PUBLICATION_JOB,
  PRE_USD_PRICE_PUBLICATION_POLL_MS,
} from '@precommunity/shared';

export async function schedulePreUsdPricePublications(
  queue: Pick<Queue, 'add' | 'setGlobalConcurrency'>,
) {
  await queue.setGlobalConcurrency(1);
  await queue.add(
    PRE_USD_PRICE_PUBLICATION_JOB,
    {},
    {
      repeat: { every: PRE_USD_PRICE_PUBLICATION_POLL_MS },
      jobId: PRE_USD_PRICE_PUBLICATION_JOB,
      attempts: 1,
      removeOnComplete: 20,
      removeOnFail: 100,
    },
  );
  await queue.add(
    PRE_USD_PRICE_PUBLICATION_JOB,
    {},
    {
      jobId: 'initial-pre-usd-price-publication',
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function scheduleAdCharges(queue: Pick<Queue, 'add' | 'setGlobalConcurrency'>) {
  await queue.setGlobalConcurrency(1);
  await queue.add(
    AD_CHARGE_JOB,
    {},
    {
      repeat: { every: AD_CHARGE_POLL_MS },
      jobId: AD_CHARGE_JOB,
      attempts: 1,
      removeOnComplete: 20,
      removeOnFail: 100,
    },
  );
  await queue.add(
    AD_CHARGE_JOB,
    {},
    {
      jobId: 'initial-ad-charge',
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function schedulePreUsdPrices(
  queue: Pick<Queue, 'add' | 'setGlobalConcurrency'>,
  enabled: boolean,
) {
  // An unconfigured replica must not disable collection on configured replicas.
  if (!enabled) return;
  await queue.setGlobalConcurrency(1);
  await queue.add(
    PRE_USD_PRICE_JOB,
    {},
    {
      repeat: { every: PRE_USD_PRICE_POLL_MS },
      jobId: PRE_USD_PRICE_JOB,
      attempts: 1,
      removeOnComplete: 20,
      removeOnFail: 100,
    },
  );
  await queue.add(
    PRE_USD_PRICE_JOB,
    {},
    {
      jobId: 'initial-pre-usd-price',
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

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
