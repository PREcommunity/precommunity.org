import { adKeywordId, normalizeAdKeyword } from '@precommunity/shared';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const DOMAIN = 'precommunity:keyword-market:delivery:v2\0';
export const AD_DELIVERY_TTL_MS = 60 * 60_000;
const CLOCK_SKEW_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;

export interface AdDelivery {
  version: 2;
  deliveryId: string;
  issuedAt: number;
  revisionId: string;
  chainId: number;
  contractAddress: string;
  keywordId: string;
  keyword: string;
  stakerAddress: string;
  positionVersion: string;
}

export function signAdDelivery(
  context: Omit<AdDelivery, 'version' | 'deliveryId' | 'issuedAt'>,
  secret: string,
) {
  const payload = Buffer.from(
    JSON.stringify({ ...context, version: 2, deliveryId: randomUUID(), issuedAt: Date.now() }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(DOMAIN).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readAdDelivery(
  token: unknown,
  revisionId: string,
  secret: string,
): AdDelivery | null {
  if (typeof token !== 'string' || token.length > 2_048) return null;
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]!) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)
  ) {
    return null;
  }
  const [payload, signature] = parts as [string, string];
  const expected = createHmac('sha256', secret).update(DOMAIN).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AdDelivery;
    const now = Date.now();
    if (
      !value ||
      value.version !== 2 ||
      !Number.isSafeInteger(value.issuedAt) ||
      value.issuedAt <= 0 ||
      value.issuedAt > now + CLOCK_SKEW_MS ||
      now - value.issuedAt >= AD_DELIVERY_TTL_MS ||
      !UUID.test(value.deliveryId) ||
      !UUID.test(value.revisionId) ||
      value.revisionId !== revisionId ||
      !Number.isSafeInteger(value.chainId) ||
      value.chainId <= 0 ||
      !ADDRESS.test(value.contractAddress) ||
      !ADDRESS.test(value.stakerAddress) ||
      !HASH.test(value.keywordId) ||
      typeof value.keyword !== 'string' ||
      normalizeAdKeyword(value.keyword) !== value.keyword ||
      adKeywordId(value.keyword) !== value.keywordId ||
      typeof value.positionVersion !== 'string' ||
      !/^[1-9]\d{0,77}$/.test(value.positionVersion) ||
      BigInt(value.positionVersion) >= 1n << 256n
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
