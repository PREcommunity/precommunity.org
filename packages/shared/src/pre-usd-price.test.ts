import { describe, expect, it } from 'vitest';
import { preUsdPriceSnapshot, usablePreUsdQuote, type PreUsdQuote } from './pre-usd-price';

const quote: PreUsdQuote = {
  id: 'quote',
  source: 'COINGECKO',
  assetId: 'presearch',
  priceUsd: '0.123456789012345678',
  quotedAt: '2026-10-09T10:00:00.000Z',
  fetchedAt: '2026-10-09T10:29:00.000Z',
};

describe('PRE/USD price freshness', () => {
  it('returns no usable price before the first quote', () => {
    const snapshot = preUsdPriceSnapshot(null);
    expect(snapshot).toEqual({ status: 'MISSING', quote: null });
    expect(usablePreUsdQuote(snapshot)).toBeNull();
  });
  it('expires from provider quote time, retaining the exact old value for display', () => {
    expect(preUsdPriceSnapshot(quote, new Date('2026-10-09T10:30:00.000Z')).status).toBe('FRESH');
    const stale = preUsdPriceSnapshot(quote, new Date('2026-10-09T10:30:00.001Z'));
    expect(stale).toEqual({ status: 'STALE', quote });
    expect(usablePreUsdQuote(stale)).toBeNull();
    expect(usablePreUsdQuote(preUsdPriceSnapshot(quote, new Date(quote.quotedAt)))).toEqual(quote);
  });
  it('does not make an old quote fresh when downloaded again', () => {
    expect(
      preUsdPriceSnapshot(
        { ...quote, fetchedAt: '2026-10-09T11:00:00.000Z' },
        new Date('2026-10-09T11:00:00.000Z'),
      ).status,
    ).toBe('STALE');
  });
  it('rejects invalid timestamps and excessive future clock skew', () => {
    expect(preUsdPriceSnapshot({ ...quote, quotedAt: 'invalid' }).status).toBe('STALE');
    expect(preUsdPriceSnapshot(quote, new Date('2026-10-09T09:59:00.000Z')).status).toBe('FRESH');
    expect(preUsdPriceSnapshot(quote, new Date('2026-10-09T09:58:59.999Z')).status).toBe('STALE');
  });
});
