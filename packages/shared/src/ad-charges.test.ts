import { describe, expect, it } from 'vitest';
import { adChargeQueueName, adWalletRefreshIntervalMs, billPreRaw } from './ad-charges';

describe('click charges', () => {
  it('converts micro USD to PRE without floating point or rounding up', () => {
    expect(billPreRaw('1000000', '0.01')).toBe('100000000000000000000');
    expect(billPreRaw('1', '3')).toBe('333333333333');
    expect(billPreRaw('123456', '0.012345678901234567')).toBe('9999936089999425539');
    expect(billPreRaw('1', '10000000000000')).toBe('0');
  });
  it.each(['0', '-1', 'NaN', '0.0000000000000000001', '1e-3'])(
    'rejects invalid prices %s',
    (price) => {
      expect(() => billPreRaw('1000000', price)).toThrow();
    },
  );
  it('isolates queues by network and contract', () => {
    expect(adChargeQueueName(8453, '0xABC')).toBe(adChargeQueueName(8453, '0xabc'));
    expect(adChargeQueueName(8453, '0xabc')).not.toBe(adChargeQueueName(84532, '0xabc'));
  });
});

describe('wallet refresh interval', () => {
  it.each([1, 5, 30, 2_147_483_647])(
    'follows the validated enabled AUTO interval of %s minutes',
    (intervalMinutes) => {
      expect(adWalletRefreshIntervalMs({ automaticEnabled: true, intervalMinutes })).toBe(
        intervalMinutes * 60_000,
      );
    },
  );
  it('uses ten minutes when AUTO is disabled or has no settings', () => {
    expect(adWalletRefreshIntervalMs()).toBe(600_000);
    expect(adWalletRefreshIntervalMs(null)).toBe(600_000);
    expect(adWalletRefreshIntervalMs({ automaticEnabled: false, intervalMinutes: 30 })).toBe(
      600_000,
    );
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])(
    'falls back for an invalid configured interval %s',
    (intervalMinutes) => {
      expect(adWalletRefreshIntervalMs({ automaticEnabled: true, intervalMinutes })).toBe(600_000);
    },
  );
});
