import { describe, expect, it } from 'vitest';
import { adChargeQueueName, billPreRaw } from './ad-charges';

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
