import { describe, expect, it, vi } from 'vitest';
import { scheduleJobs } from './schedule';

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
