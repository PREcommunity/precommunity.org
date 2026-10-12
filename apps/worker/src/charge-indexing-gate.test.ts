import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@precommunity/database';
import { runKeywordMarketIndexing } from './application-features';

describe('indexing while billing debt remains', () => {
  it.each(['click', 'batch'])(
    'keeps indexing for a pending %s when ad delivery is disabled',
    async (kind) => {
      const database = {
        communitySettings: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ keywordMarketEnabled: false, keywordMarketRequireReview: true }),
        },
        adBillingClick: {
          findFirst: vi.fn().mockResolvedValue(kind === 'click' ? { id: 'click' } : null),
        },
        adChargeBatch: {
          findFirst: vi.fn().mockResolvedValue(kind === 'batch' ? { id: 'batch' } : null),
        },
      } as unknown as PrismaClient;
      const run = vi.fn().mockResolvedValue({ processed: 1 });
      expect(
        await runKeywordMarketIndexing(database, run, {
          chainId: 8453,
          contractAddress: '0xmarket',
        }),
      ).toEqual({ processed: 1 });
      expect(run).toHaveBeenCalledOnce();
    },
  );
  it('preserves the disabled state without outstanding debt', async () => {
    const database = {
      communitySettings: { findFirst: vi.fn().mockResolvedValue(null) },
      adBillingClick: { findFirst: vi.fn().mockResolvedValue(null) },
      adChargeBatch: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const run = vi.fn();
    expect(
      await runKeywordMarketIndexing(database, run, { chainId: 8453, contractAddress: '0xmarket' }),
    ).toMatchObject({ status: 'DISABLED' });
    expect(run).not.toHaveBeenCalled();
  });
});
