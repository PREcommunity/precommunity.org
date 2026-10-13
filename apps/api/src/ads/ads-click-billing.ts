import { Prisma } from '@precommunity/database';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { AdDelivery } from './ads-delivery';

const FINGERPRINT_DOMAIN = 'precommunity:keyword-market:billing-window:v1\0';

export function canonicalClickIp(ip?: string): string | null {
  if (!ip) return null;
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6 || ip.includes('%')) return null;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1]!, 16);
  const low = parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function clickBillingFingerprint(
  delivery: Pick<AdDelivery, 'chainId' | 'contractAddress'>,
  campaignId: string,
  ip: string | undefined,
  secret: string,
) {
  const canonicalIp = canonicalClickIp(ip);
  if (!canonicalIp) return null;
  return createHmac('sha256', secret)
    .update(FINGERPRINT_DOMAIN)
    .update(
      JSON.stringify([
        delivery.chainId,
        delivery.contractAddress.toLowerCase(),
        campaignId,
        canonicalIp,
      ]),
    )
    .digest('hex');
}

export function clickBillingWindowClaim(fingerprint: string) {
  return Prisma.sql`
    INSERT INTO "AdBillingClickWindow" ("fingerprint", "expiresAt")
    VALUES (${fingerprint}, CURRENT_TIMESTAMP + INTERVAL '5 minutes')
    ON CONFLICT ("fingerprint") DO UPDATE
      SET "expiresAt" = EXCLUDED."expiresAt"
      WHERE "AdBillingClickWindow"."expiresAt" <= CURRENT_TIMESTAMP
    RETURNING "fingerprint"
  `;
}

export async function claimClickBillingWindow(
  transaction: Pick<Prisma.TransactionClient, '$queryRaw'>,
  fingerprint: string,
) {
  const claimed = await transaction.$queryRaw<Array<{ fingerprint: string }>>(
    clickBillingWindowClaim(fingerprint),
  );
  return claimed.length === 1;
}
