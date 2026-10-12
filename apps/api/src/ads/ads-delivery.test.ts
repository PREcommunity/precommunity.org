import { adKeywordId } from '@precommunity/shared';
import { describe, expect, it } from 'vitest';
import { readAdDelivery, signAdDelivery } from './ads-delivery';

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
});
