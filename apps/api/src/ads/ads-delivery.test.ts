import { adKeywordId } from '@precommunity/shared';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AD_DELIVERY_TTL_MS, readAdDelivery, signAdDelivery } from './ads-delivery';

const context = {
  revisionId: '00000000-0000-4000-8000-000000000001',
  chainId: 84532,
  contractAddress: `0x${'1'.repeat(40)}`,
  keywordId: adKeywordId('bitcoin'),
  keyword: 'bitcoin',
  stakerAddress: `0x${'2'.repeat(40)}`,
  positionVersion: '1',
};
const secret = 'unit-test-delivery-signing-secret';

afterEach(() => vi.useRealTimers());

function signedPayload(value: unknown, version = 2) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`precommunity:keyword-market:delivery:v${version}\0`)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

describe('signed Keyword Market deliveries', () => {
  it('creates independent links for the same selected ad and keeps the original position identity', () => {
    const first = signAdDelivery(context, secret);
    const second = signAdDelivery(context, secret);
    expect(first).not.toBe(second);
    expect(readAdDelivery(first, context.revisionId, secret)).toMatchObject(context);
    expect(readAdDelivery(second, context.revisionId, secret)?.deliveryId).not.toBe(
      readAdDelivery(first, context.revisionId, secret)?.deliveryId,
    );
  });

  it('rejects a changed position, different revision, malformed query, or different signing secret', () => {
    const token = signAdDelivery(context, secret);
    const [payload, signature] = token.split('.');
    const changed = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    changed.positionVersion = '2';
    const tampered = `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
    expect(readAdDelivery(tampered, context.revisionId, secret)).toBeNull();
    expect(readAdDelivery(token, '00000000-0000-4000-8000-000000000002', secret)).toBeNull();
    expect(readAdDelivery(token, context.revisionId, `${secret}-changed`)).toBeNull();
    for (const value of [undefined, ['token'], {}, 'broken', `${token}.extra`, 'x'.repeat(2_049)]) {
      expect(readAdDelivery(value, context.revisionId, secret)).toBeNull();
    }
  });

  it('rejects a signed but inconsistent keyword identity', () => {
    const token = signAdDelivery({ ...context, keyword: 'ethereum' }, secret);
    expect(readAdDelivery(token, context.revisionId, secret)).toBeNull();
  });

  it('expires at one hour without accepting an old token after time has advanced', () => {
    vi.useFakeTimers();
    const issuedAt = new Date('2026-10-13T12:00:00Z').getTime();
    vi.setSystemTime(issuedAt);
    const token = signAdDelivery(context, secret);
    expect(readAdDelivery(token, context.revisionId, secret)).toMatchObject({
      version: 2,
      issuedAt,
    });
    vi.setSystemTime(issuedAt + AD_DELIVERY_TTL_MS - 1);
    expect(readAdDelivery(token, context.revisionId, secret)).not.toBeNull();
    vi.setSystemTime(issuedAt + AD_DELIVERY_TTL_MS);
    expect(readAdDelivery(token, context.revisionId, secret)).toBeNull();
    vi.setSystemTime(issuedAt + 10 * 365 * 24 * 60 * 60_000);
    expect(readAdDelivery(token, context.revisionId, secret)).toBeNull();
  });

  it('allows at most sixty seconds of clock skew and rejects invalid issue times', () => {
    vi.useFakeTimers();
    const now = new Date('2026-10-13T12:00:00Z').getTime();
    vi.setSystemTime(now);
    const value = readAdDelivery(signAdDelivery(context, secret), context.revisionId, secret)!;
    expect(
      readAdDelivery(
        signedPayload({ ...value, issuedAt: now + 60_000 }),
        context.revisionId,
        secret,
      ),
    ).not.toBeNull();
    for (const issuedAt of [
      undefined,
      null,
      0,
      -1,
      1.5,
      'today',
      now + 60_001,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        readAdDelivery(signedPayload({ ...value, issuedAt }), context.revisionId, secret),
      ).toBeNull();
    }
  });

  it('rejects legacy v1 deliveries even when signed with the current secret', () => {
    const value = readAdDelivery(signAdDelivery(context, secret), context.revisionId, secret)!;
    const { issuedAt: _issuedAt, ...legacy } = value;
    expect(
      readAdDelivery(signedPayload({ ...legacy, version: 1 }, 1), context.revisionId, secret),
    ).toBeNull();
    expect(
      readAdDelivery(signedPayload({ ...value, version: 1 }), context.revisionId, secret),
    ).toBeNull();
  });
});
