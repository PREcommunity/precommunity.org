import { describe, expect, it, vi } from 'vitest';
import {
  scheduleAdCharges,
  scheduleJobs,
  schedulePreUsdPrices,
  schedulePreUsdPricePublications,
} from './schedule';

describe('worker schedules', () => {
  it('retains queue routing, ordering, intervals, IDs and retention', async () => {
    const calls: unknown[] = [];
    const queue = {
      add: vi.fn(async (...args: unknown[]) => {
        calls.push(['chain', ...args]);
      }),
    };
    const safe = {
      add: vi.fn(async (...args: unknown[]) => {
        calls.push(['safe', ...args]);
      }),
      removeRepeatable: vi.fn(async (...args: unknown[]) => {
        calls.push(['remove', ...args]);
      }),
    };
    await scheduleJobs(queue as never, safe as never);
    expect(calls).toEqual([
      ['remove', 'sync-safe-goal-managers', { every: 30_000 }, 'sync-safe-goal-managers'],
      ...(
        [
          ['chain', 'index-escrow', 15_000],
          ['chain', 'reconcile-escrow', 300_000],
          ['chain', 'refresh-metadata', 300_000],
          ['chain', 'index-ads', 15_000],
          ['chain', 'flush-ad-metrics', 60_000],
          ['chain', 'retain-ads-data', 86_400_000],
          ['safe', 'sync-safe-payouts', 30_000],
          ['safe', 'sync-safe-goal-actions', 30_000],
        ] as const
      ).map(([target, name, every]) => [
        target,
        name,
        {},
        { repeat: { every }, jobId: name, removeOnComplete: 20, removeOnFail: 100 },
      ]),
    ]);
  });
});

describe('PRE/USD schedule', () => {
  function queue() {
    return { add: vi.fn(), removeRepeatable: vi.fn(), setGlobalConcurrency: vi.fn() };
  }
  it('sets global concurrency and a shared repeatable schedule plus immediate startup work', async () => {
    const prices = queue();
    await schedulePreUsdPrices(prices as never, true);
    expect(prices.setGlobalConcurrency).toHaveBeenCalledWith(1);
    expect(prices.add.mock.calls).toEqual([
      [
        'fetch-pre-usd-price',
        {},
        {
          repeat: { every: 600_000 },
          jobId: 'fetch-pre-usd-price',
          attempts: 1,
          removeOnComplete: 20,
          removeOnFail: 100,
        },
      ],
      [
        'fetch-pre-usd-price',
        {},
        { jobId: 'initial-pre-usd-price', attempts: 1, removeOnComplete: true, removeOnFail: true },
      ],
    ]);
    await schedulePreUsdPrices(prices as never, true);
    expect(prices.add.mock.calls[2]).toEqual(prices.add.mock.calls[0]);
  });
  it('leaves configured replicas and their shared schedule untouched without a key', async () => {
    const prices = queue();
    await schedulePreUsdPrices(prices as never, false);
    expect(prices.add).not.toHaveBeenCalled();
    expect(prices.removeRepeatable).not.toHaveBeenCalled();
    expect(prices.setGlobalConcurrency).not.toHaveBeenCalled();
  });
});

describe('charge schedule', () => {
  it('serializes deployment jobs globally and ticks even without automatic charging', async () => {
    const queue = { add: vi.fn(), setGlobalConcurrency: vi.fn() };
    await scheduleAdCharges(queue as never);
    expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(1);
    expect(queue.add.mock.calls).toEqual([
      [
        'charge-ad-stakes',
        {},
        {
          repeat: { every: 15_000 },
          jobId: 'charge-ad-stakes',
          attempts: 1,
          removeOnComplete: 20,
          removeOnFail: 100,
        },
      ],
      [
        'charge-ad-stakes',
        {},
        { jobId: 'initial-ad-charge', attempts: 1, removeOnComplete: true, removeOnFail: true },
      ],
    ]);
  });
});

describe('price publication schedule', () => {
  it('runs an independent serialized startup and recovery tick without collector or charge settings', async () => {
    const queue = { add: vi.fn(), setGlobalConcurrency: vi.fn() };
    await schedulePreUsdPricePublications(queue as never);
    expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(1);
    expect(queue.add.mock.calls).toEqual([
      [
        'publish-pre-usd-price',
        {},
        {
          repeat: { every: 15_000 },
          jobId: 'publish-pre-usd-price',
          attempts: 1,
          removeOnComplete: 20,
          removeOnFail: 100,
        },
      ],
      [
        'publish-pre-usd-price',
        {},
        {
          jobId: 'initial-pre-usd-price-publication',
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      ],
    ]);
  });
});
