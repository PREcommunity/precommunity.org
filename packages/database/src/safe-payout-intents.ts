import { PayoutStatus, type PrismaClient } from './generated/prisma/client';

interface SafePayoutIntentScope {
  chainId: number;
  safeAddress?: string;
}

/**
 * Claims expired intents before failing their payouts. A concurrent proposal submission uses the
 * same consumedAt claim, so only one of the two transitions can win.
 */
export async function expireUnconsumedSafePayoutIntents(
  database: PrismaClient,
  scope: SafePayoutIntentScope,
  now = new Date(),
) {
  const candidates = await database.safePayoutIntent.findMany({
    where: {
      chainId: scope.chainId,
      ...(scope.safeAddress ? { safeAddress: scope.safeAddress.toLowerCase() } : {}),
      consumedAt: null,
      expiresAt: { lte: now },
      proposal: { is: null },
      payout: { status: PayoutStatus.PROPOSED },
    },
    select: { id: true, payoutId: true },
  });
  if (!candidates.length) return 0;

  return database.$transaction(async (tx) => {
    const payoutIds: string[] = [];

    for (const candidate of candidates) {
      const claimed = await tx.safePayoutIntent.updateMany({
        where: {
          id: candidate.id,
          consumedAt: null,
          expiresAt: { lte: now },
          proposal: { is: null },
          payout: { status: PayoutStatus.PROPOSED },
        },
        data: { consumedAt: now },
      });
      if (claimed.count === 1) payoutIds.push(candidate.payoutId);
    }

    if (payoutIds.length) {
      await tx.payout.updateMany({
        where: { id: { in: payoutIds }, status: PayoutStatus.PROPOSED },
        data: { status: PayoutStatus.FAILED },
      });
    }

    return payoutIds.length;
  });
}
