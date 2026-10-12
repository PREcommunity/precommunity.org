import { Prisma } from '@precommunity/database';

const inFlight = ['SIGNED', 'SUBMITTED', 'RECONCILING'];

/** Both journals reserve one chain nonce while this transaction holds the wallet lock. */
export async function readKeywordMarketWalletReservation(
  tx: Prisma.TransactionClient,
  chainId: number,
  signerAddress: string,
  own: { chargeId?: string; publicationId?: string },
) {
  const wallet = { chainId, signerAddress: signerAddress.toLowerCase() };
  const key = `keyword-market-wallet:${chainId}:${wallet.signerAddress}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  const [pendingCharge, pendingPublication, latestCharge, latestPublication] = await Promise.all([
    tx.adChargeBatch.findFirst({
      where: {
        ...wallet,
        status: { in: inFlight },
        ...(own.chargeId ? { id: { not: own.chargeId } } : {}),
      },
      select: { nonce: true },
    }),
    tx.adPricePublication.findFirst({
      where: {
        ...wallet,
        status: { in: inFlight },
        ...(own.publicationId ? { id: { not: own.publicationId } } : {}),
      },
      select: { nonce: true },
    }),
    tx.adChargeBatch.findFirst({
      where: { ...wallet, nonce: { not: null } },
      orderBy: { nonce: 'desc' },
      select: { nonce: true },
    }),
    tx.adPricePublication.findFirst({
      where: { ...wallet, nonce: { not: null } },
      orderBy: { nonce: 'desc' },
      select: { nonce: true },
    }),
  ]);
  const chargeNonce = latestCharge?.nonce ?? null;
  const publicationNonce = latestPublication?.nonce ?? null;
  return {
    pending: Boolean(pendingCharge || pendingPublication),
    latestNonce:
      chargeNonce === null
        ? publicationNonce
        : publicationNonce === null || chargeNonce > publicationNonce
          ? chargeNonce
          : publicationNonce,
  };
}
