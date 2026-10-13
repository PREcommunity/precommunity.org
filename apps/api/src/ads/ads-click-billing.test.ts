import { describe, expect, it } from 'vitest';
import { canonicalClickIp, clickBillingFingerprint } from './ads-click-billing';

describe('billing client fingerprint', () => {
  it.each([
    ['192.0.2.1', '192.0.2.1'],
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['0:0:0:0:0:ffff:c000:201', '192.0.2.1'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
    ['::1', '::1'],
    [undefined, null],
    ['', null],
    ['unknown', null],
    ['192.0.2.999', null],
    ['192.0.2.1, 192.0.2.2', null],
    ['fe80::1%en0', null],
  ])('normalizes client address %s', (ip, expected) => {
    expect(canonicalClickIp(ip ?? undefined)).toBe(expected);
  });

  it('scopes a private IP fingerprint to the network, contract and campaign', () => {
    const secret = 'private-fingerprint-secret';
    const delivery = { chainId: 84532, contractAddress: `0x${'a'.repeat(40)}` };
    const fingerprint = clickBillingFingerprint(delivery, 'campaign-1', '192.0.2.1', secret);
    expect(fingerprint).toMatch(/^[a-f\d]{64}$/);
    expect(clickBillingFingerprint(delivery, 'campaign-1', '::ffff:192.0.2.1', secret)).toBe(
      fingerprint,
    );
    expect(
      clickBillingFingerprint(
        { ...delivery, contractAddress: delivery.contractAddress.toUpperCase() },
        'campaign-1',
        '192.0.2.1',
        secret,
      ),
    ).toBe(fingerprint);
    for (const [scope, campaign, ip, key] of [
      [{ ...delivery, chainId: 8453 }, 'campaign-1', '192.0.2.1', secret],
      [{ ...delivery, contractAddress: `0x${'b'.repeat(40)}` }, 'campaign-1', '192.0.2.1', secret],
      [delivery, 'campaign-2', '192.0.2.1', secret],
      [delivery, 'campaign-1', '192.0.2.2', secret],
      [delivery, 'campaign-1', '192.0.2.1', 'another-secret'],
    ] as const) {
      expect(clickBillingFingerprint(scope, campaign, ip, key)).not.toBe(fingerprint);
    }
    expect(clickBillingFingerprint(delivery, 'campaign-1', undefined, secret)).toBeNull();
  });
});
