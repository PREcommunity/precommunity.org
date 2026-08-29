import {
  PayoutStatus,
  type PrismaClient,
  expireUnconsumedSafePayoutIntents,
} from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';

describe('expired Safe payout intents', () => {
  it('fails payouts only for intents won by the expiration claim', async () => {
    const now = new Date('2026-08-15T09:00:00.000Z');
    const claim = vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const failPayouts = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      safePayoutIntent: { updateMany: claim },
      payout: { updateMany: failPayouts },
    };
    const database = {
      safePayoutIntent: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'intent-submitted-concurrently', payoutId: 'payout-keep' },
          { id: 'intent-expired', payoutId: 'payout-fail' },
        ]),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<number>) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient;

    await expect(
      expireUnconsumedSafePayoutIntents(database, { chainId: 84532 }, now),
    ).resolves.toBe(1);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledWith({
      where: {
        id: 'intent-expired',
        consumedAt: null,
        expiresAt: { lte: now },
        proposal: { is: null },
        payout: { status: PayoutStatus.PROPOSED },
      },
      data: { consumedAt: now },
    });
    expect(failPayouts).toHaveBeenCalledWith({
      where: { id: { in: ['payout-fail'] }, status: PayoutStatus.PROPOSED },
      data: { status: PayoutStatus.FAILED },
    });
  });
});
