import { Logger } from '@nestjs/common';
import { Prisma } from '@precommunity/database';
import { adKeywordId } from '@precommunity/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { AdsService } from './ads.service';
import { readAdDelivery, signAdDelivery } from './ads-delivery';

const revisionId = '00000000-0000-4000-8000-000000000001';
const context = {
  revisionId,
  chainId: 84532,
  contractAddress: `0x${'1'.repeat(40)}`,
  keywordId: adKeywordId('bitcoin'),
  keyword: 'bitcoin',
  stakerAddress: `0x${'2'.repeat(40)}`,
  positionVersion: '1',
};

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const createMany = vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
    const row = data[0]!;
    const id = String(row.id);
    if (rows.has(id)) return { count: 0 };
    rows.set(id, { ...row });
    return { count: 1 };
  });
  const updateMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; status: string };
      data: Record<string, unknown>;
    }) => {
      const row = rows.get(where.id);
      if (!row || row.status !== where.status) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  );
  const quote = {
    id: '00000000-0000-4000-8000-000000000003',
    source: 'COINGECKO',
    assetId: 'presearch',
    priceUsd: new Prisma.Decimal('0.01'),
    quotedAt: new Date(),
    fetchedAt: new Date(),
  };
  const priceRead = vi.fn().mockResolvedValue(quote);
  const chainQuote = {
    preUsdPriceE18: '10000000000000000',
    preUsdPriceQuotedAt: Math.floor(Date.now() / 1000).toString(),
  };
  const billingPosition = vi.fn().mockImplementation(async () => ({
    status: 'FOUND',
    bidUsdRaw: '100000',
    source: 'RPC',
    blockNumber: 100n,
    blockHash: `0x${'3'.repeat(64)}`,
    ...chainQuote,
  }));
  const incrementClick = vi.fn().mockResolvedValue(true);
  const logger = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const service = new AdsService(
    {
      adCreativeRevision: {
        findFirst: vi.fn().mockResolvedValue({ destinationUrl: 'https://example.com/' }),
      },
      adBillingClick: { createMany, updateMany },
      preUsdPrice: { findFirst: priceRead },
    } as never,
    { incrementClick } as never,
    { billingPosition } as never,
  );
  const token = signAdDelivery(context, config.SESSION_SECRET);
  const deliveryId = readAdDelivery(token, revisionId, config.SESSION_SECRET)!.deliveryId;
  return {
    service,
    rows,
    quote,
    chainQuote,
    priceRead,
    billingPosition,
    incrementClick,
    createMany,
    updateMany,
    logger,
    token,
    deliveryId,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('durable click billing capture', () => {
  it('claims the first click, freezes its current bid and quote, and ignores simultaneous replay', async () => {
    const f = fixture();
    let resolvePosition!: (value: unknown) => void;
    f.billingPosition.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePosition = resolve;
        }),
    );
    const first = f.service.click(revisionId, true, f.token);
    await vi.waitFor(() => expect(f.billingPosition).toHaveBeenCalledOnce());
    expect(f.rows.get(f.deliveryId)?.status).toBe('CAPTURING');
    await expect(f.service.click(revisionId, true, f.token)).resolves.toBe('https://example.com/');
    resolvePosition({
      status: 'FOUND',
      bidUsdRaw: '250000',
      source: 'RPC',
      blockNumber: 101n,
      blockHash: `0x${'4'.repeat(64)}`,
      ...f.chainQuote,
    });
    await expect(first).resolves.toBe('https://example.com/');
    expect(f.rows.get(f.deliveryId)).toMatchObject({
      status: 'PENDING',
      bidUsdRaw: '250000',
      amountPreRaw: '25000000000000000000',
      priceQuoteId: null,
      priceUsd: '0.01',
      priceQuotedAt: new Date(Number(f.chainQuote.preUsdPriceQuotedAt) * 1000),
      captureSource: 'RPC',
      bidBlockNumber: 101n,
      priceBlockNumber: 101n,
      priceBlockHash: `0x${'4'.repeat(64)}`,
    });
    f.quote.priceUsd = new Prisma.Decimal('0.02');
    await f.service.click(revisionId, true, f.token);
    expect(f.priceRead).not.toHaveBeenCalled();
    expect(f.billingPosition).toHaveBeenCalledOnce();
    expect(f.rows.get(f.deliveryId)?.amountPreRaw).toBe('25000000000000000000');
    expect(f.incrementClick).toHaveBeenCalledTimes(3);
  });

  it('keeps USD debt when the contract price is missing despite a fresh database quote', async () => {
    const f = fixture();
    f.chainQuote.preUsdPriceE18 = '0';
    await expect(f.service.click(revisionId, true, f.token)).resolves.toBe('https://example.com/');
    expect(f.rows.get(f.deliveryId)).toMatchObject({
      status: 'PRICE_PENDING',
      bidUsdRaw: '100000',
      amountPreRaw: null,
      priceQuoteId: null,
      priceUsd: null,
      priceBlockNumber: null,
      priceBlockHash: null,
      captureSource: 'RPC',
    });
    expect(f.priceRead).not.toHaveBeenCalled();
  });

  it('uses an old contract quote even when the database contains a newer different price', async () => {
    const f = fixture();
    f.chainQuote.preUsdPriceQuotedAt = Math.floor((Date.now() - 31 * 60_000) / 1000).toString();
    f.quote.priceUsd = new Prisma.Decimal('0.02');
    await f.service.click(revisionId, true, f.token);
    expect(f.rows.get(f.deliveryId)).toMatchObject({
      status: 'PENDING',
      amountPreRaw: '10000000000000000000',
      priceUsd: '0.01',
      priceQuoteId: null,
      priceQuotedAt: new Date(Number(f.chainQuote.preUsdPriceQuotedAt) * 1000),
    });
    expect(f.priceRead).not.toHaveBeenCalled();
  });

  it('preserves a failed first capture as an unbilled tombstone after RPC recovery', async () => {
    const f = fixture();
    f.billingPosition.mockResolvedValue({
      status: 'UNAVAILABLE',
      errorCode: 'CAPTURE_FAILED',
    } as never);
    await expect(f.service.click(revisionId, true, f.token)).resolves.toBe('https://example.com/');
    expect(f.rows.get(f.deliveryId)).toMatchObject({
      status: 'UNBILLED',
      errorCode: 'CAPTURE_FAILED',
    });
    f.billingPosition.mockResolvedValue({
      status: 'FOUND',
      bidUsdRaw: '999999',
      source: 'RPC',
      blockNumber: 102n,
      blockHash: `0x${'4'.repeat(64)}`,
      ...f.chainQuote,
    });
    await f.service.click(revisionId, true, f.token);
    expect(f.billingPosition).toHaveBeenCalledOnce();
    expect(f.rows.get(f.deliveryId)?.status).toBe('UNBILLED');
  });

  it('records projection fallback evidence and handles values below one PRE wei without submitting debt', async () => {
    const f = fixture();
    f.chainQuote.preUsdPriceE18 = (10n ** 31n).toString();
    f.billingPosition.mockResolvedValue({
      status: 'FOUND',
      bidUsdRaw: '1',
      source: 'PROJECTION',
      blockNumber: 90n,
      blockHash: `0x${'5'.repeat(64)}`,
      ...f.chainQuote,
    });
    await f.service.click(revisionId, true, f.token);
    expect(f.rows.get(f.deliveryId)).toMatchObject({
      status: 'SETTLED',
      amountPreRaw: '0',
      captureSource: 'PROJECTION',
      bidBlockNumber: 90n,
    });
  });

  it('keeps legacy, invalid and prefetch links unbilled, with regular analytics intact', async () => {
    const f = fixture();
    await f.service.click(revisionId);
    await f.service.click(revisionId, true, 'invalid');
    await f.service.click(revisionId, false, f.token);
    expect(f.createMany).not.toHaveBeenCalled();
    expect(f.billingPosition).not.toHaveBeenCalled();
    expect(f.incrementClick).toHaveBeenCalledTimes(2);
  });

  it('redirects on database failure and logs only a sanitized capture code', async () => {
    const f = fixture();
    f.createMany.mockRejectedValue(new Error('sensitive database credentials'));
    await expect(f.service.click(revisionId, true, f.token)).resolves.toBe('https://example.com/');
    expect(f.billingPosition).not.toHaveBeenCalled();
    expect(f.logger).toHaveBeenCalledWith({
      event: 'AD_BILLING_CAPTURE_FAILED',
      clickId: f.deliveryId,
      code: 'CAPTURE_FAILED',
    });
    expect(JSON.stringify(f.logger.mock.calls)).not.toContain('sensitive');
  });
});
