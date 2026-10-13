import { Logger } from '@nestjs/common';
import { Prisma } from '@precommunity/database';
import { adKeywordId } from '@precommunity/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { AdsService } from './ads.service';
import { readAdDelivery, signAdDelivery } from './ads-delivery';

const revisionId = '00000000-0000-4000-8000-000000000001';
const campaignId = '00000000-0000-4000-8000-000000000004';
const ip = '192.0.2.1';
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
  const windows = new Map<string, number>();
  const totals = { billableClicks: 0n, suppressedClicks: 0n };
  const totalsUpsert = vi.fn(
    async ({
      update,
    }: {
      update: { billableClicks?: { increment: bigint }; suppressedClicks?: { increment: bigint } };
    }) => {
      totals.billableClicks += update.billableClicks?.increment ?? 0n;
      totals.suppressedClicks += update.suppressedClicks?.increment ?? 0n;
    },
  );
  const clock = { now: Date.now() };
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
  const claimWindow = vi.fn(async (query: Prisma.Sql) => {
    const fingerprint = String(query.values[0]);
    const expiresAt = windows.get(fingerprint);
    if (expiresAt !== undefined && expiresAt > clock.now) return [];
    windows.set(fingerprint, clock.now + 5 * 60_000);
    return [{ fingerprint }];
  });
  const revisionRead = vi
    .fn()
    .mockResolvedValue({ destinationUrl: 'https://example.com/', campaignId });
  const tx = {
    adBillingClick: { updateMany },
    adBillingClickTotals: { upsert: totalsUpsert },
    $queryRaw: claimWindow,
  };
  let transactionTail = Promise.resolve();
  const transaction = vi.fn((run: (value: typeof tx) => Promise<void>) => {
    const pending = transactionTail.then(async () => {
      const originalRows = new Map([...rows].map(([id, row]) => [id, { ...row }]));
      const originalWindows = new Map(windows);
      const originalTotals = { ...totals };
      try {
        await run(tx);
      } catch (error) {
        rows.clear();
        originalRows.forEach((row, id) => rows.set(id, row));
        windows.clear();
        originalWindows.forEach((expiresAt, fingerprint) => windows.set(fingerprint, expiresAt));
        Object.assign(totals, originalTotals);
        throw error;
      }
    });
    transactionTail = pending.catch(() => undefined);
    return pending;
  });
  const prisma = {
    adCreativeRevision: { findFirst: revisionRead },
    adBillingClick: { createMany, updateMany },
    preUsdPrice: { findFirst: priceRead },
    $transaction: transaction,
  };
  const createService = () =>
    new AdsService(prisma as never, { incrementClick } as never, { billingPosition } as never);
  const service = createService();
  const newDelivery = (deliveryContext = context) => {
    const token = signAdDelivery(deliveryContext, config.ADS_DELIVERY_SECRET);
    const deliveryId = readAdDelivery(
      token,
      deliveryContext.revisionId,
      config.ADS_DELIVERY_SECRET,
    )!.deliveryId;
    return { token, deliveryId };
  };
  const { token, deliveryId } = newDelivery();
  return {
    service,
    rows,
    windows,
    totals,
    totalsUpsert,
    clock,
    claimWindow,
    transaction,
    createService,
    newDelivery,
    revisionRead,
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
  it('admits one of two concurrent deliveries across API instances for the same campaign and IP', async () => {
    const f = fixture();
    const second = f.newDelivery();
    await Promise.all([
      f.service.click(revisionId, true, f.token, ip),
      f.createService().click(revisionId, true, second.token, `::ffff:${ip}`),
    ]);
    expect([...f.rows.values()].map((row) => row.status).sort()).toEqual(['PENDING', 'SUPPRESSED']);
    expect(f.windows.size).toBe(1);
    expect(f.billingPosition).toHaveBeenCalledTimes(2);
    expect(f.incrementClick).toHaveBeenCalledTimes(2);
    expect(f.totals).toEqual({ billableClicks: 1n, suppressedClicks: 1n });
    expect(f.totalsUpsert.mock.calls[0]?.[0]).toMatchObject({
      where: {
        chainId_contractAddress: {
          chainId: context.chainId,
          contractAddress: context.contractAddress,
        },
      },
    });
  });

  it('does not extend the five-minute window or bill a suppressed delivery replayed from another IP', async () => {
    const f = fixture();
    await f.service.click(revisionId, true, f.token, ip);
    const firstExpiry = [...f.windows.values()][0];
    f.clock.now += 5 * 60_000 - 1;
    const second = f.newDelivery();
    await f.service.click(revisionId, true, second.token, ip);
    expect(f.rows.get(second.deliveryId)).toMatchObject({
      status: 'SUPPRESSED',
      errorCode: 'DUPLICATE_CLIENT_WINDOW',
    });
    expect([...f.windows.values()]).toEqual([firstExpiry]);
    await f.service.click(revisionId, true, second.token, '192.0.2.2');
    expect(f.billingPosition).toHaveBeenCalledTimes(2);
    f.clock.now += 1;
    await f.service.click(revisionId, true, f.token, ip);
    await f.service.click(revisionId, true, second.token, ip);
    expect(f.billingPosition).toHaveBeenCalledTimes(2);
    const third = f.newDelivery();
    await f.service.click(revisionId, true, third.token, ip);
    expect(f.rows.get(third.deliveryId)?.status).toBe('PENDING');
    expect([...f.windows.values()][0]).toBe(f.clock.now + 5 * 60_000);
    expect(f.totals).toEqual({ billableClicks: 2n, suppressedClicks: 1n });
  });

  it('allows different IPs and campaigns while keeping replacements in the original campaign window', async () => {
    const f = fixture();
    await f.service.click(revisionId, true, f.token, ip);
    const otherViewer = f.newDelivery();
    await f.service.click(revisionId, true, otherViewer.token, '192.0.2.2');
    const replacementId = '00000000-0000-4000-8000-000000000005';
    const replacement = f.newDelivery({ ...context, revisionId: replacementId });
    await f.service.click(replacementId, true, replacement.token, ip);
    expect(f.rows.get(replacement.deliveryId)?.status).toBe('SUPPRESSED');
    const otherCampaign = f.newDelivery({ ...context, revisionId: replacementId });
    f.revisionRead.mockResolvedValueOnce({
      destinationUrl: 'https://example.com/',
      campaignId: '00000000-0000-4000-8000-000000000006',
    });
    await f.service.click(replacementId, true, otherCampaign.token, ip);
    expect(f.rows.get(otherViewer.deliveryId)?.status).toBe('PENDING');
    expect(f.rows.get(otherCampaign.deliveryId)?.status).toBe('PENDING');
    expect(f.windows.size).toBe(3);
  });

  it.each([undefined, 'unknown', '192.0.2.999', '192.0.2.1, 192.0.2.2', 'fe80::1%en0'])(
    'keeps a missing or invalid client IP unbilled without reading the bid: %s',
    async (clientIp) => {
      const f = fixture();
      await expect(f.service.click(revisionId, true, f.token, clientIp)).resolves.toBe(
        'https://example.com/',
      );
      expect(f.rows.get(f.deliveryId)).toMatchObject({
        status: 'UNBILLED',
        errorCode: 'CLIENT_IP_UNAVAILABLE',
      });
      expect(f.billingPosition).not.toHaveBeenCalled();
      expect(f.claimWindow).not.toHaveBeenCalled();
      await f.service.click(revisionId, true, f.token, ip);
      expect(f.billingPosition).not.toHaveBeenCalled();
    },
  );

  it('rolls back the client window when the final ledger write fails, without retrying that delivery', async () => {
    const f = fixture();
    f.updateMany.mockRejectedValueOnce(new Error('private database failure'));
    await expect(f.service.click(revisionId, true, f.token, ip)).resolves.toBe(
      'https://example.com/',
    );
    expect(f.windows.size).toBe(0);
    expect(f.totals).toEqual({ billableClicks: 0n, suppressedClicks: 0n });
    expect(f.rows.get(f.deliveryId)).toMatchObject({
      status: 'UNBILLED',
      errorCode: 'CAPTURE_FAILED',
    });
    await f.service.click(revisionId, true, f.token, ip);
    expect(f.billingPosition).toHaveBeenCalledOnce();
    const next = f.newDelivery();
    await f.service.click(revisionId, true, next.token, ip);
    expect(f.rows.get(next.deliveryId)?.status).toBe('PENDING');
    expect(f.windows.size).toBe(1);
    expect(f.totals).toEqual({ billableClicks: 1n, suppressedClicks: 0n });
    expect(JSON.stringify(f.logger.mock.calls)).not.toContain('private database failure');
  });

  it('redirects without billing when the durable window claim is unavailable', async () => {
    const f = fixture();
    f.claimWindow.mockRejectedValueOnce(new Error('window store unavailable'));
    await expect(f.service.click(revisionId, true, f.token, ip)).resolves.toBe(
      'https://example.com/',
    );
    expect(f.rows.get(f.deliveryId)?.status).toBe('UNBILLED');
    expect(f.windows.size).toBe(0);
  });

  it('rolls back debt, the client window and totals when a totals write fails', async () => {
    const f = fixture();
    f.totalsUpsert.mockImplementationOnce(async () => {
      f.totals.billableClicks += 1n;
      throw new Error('totals unavailable');
    });
    await expect(f.service.click(revisionId, true, f.token, ip)).resolves.toBe(
      'https://example.com/',
    );
    expect(f.rows.get(f.deliveryId)?.status).toBe('UNBILLED');
    expect(f.windows.size).toBe(0);
    expect(f.totals).toEqual({ billableClicks: 0n, suppressedClicks: 0n });
    await f.service.click(revisionId, true, f.token, ip);
    expect(f.totalsUpsert).toHaveBeenCalledOnce();
    const next = f.newDelivery();
    await f.service.click(revisionId, true, next.token, ip);
    expect(f.totals).toEqual({ billableClicks: 1n, suppressedClicks: 0n });
  });

  it('rolls back the window if the claimed ledger row changed before finalization', async () => {
    const f = fixture();
    f.updateMany.mockResolvedValueOnce({ count: 0 });
    await f.service.click(revisionId, true, f.token, ip);
    expect(f.rows.get(f.deliveryId)?.status).toBe('UNBILLED');
    expect(f.windows.size).toBe(0);
  });

  it('claims the first click, freezes its current bid and quote, and ignores simultaneous replay', async () => {
    const f = fixture();
    let resolvePosition!: (value: unknown) => void;
    f.billingPosition.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePosition = resolve;
        }),
    );
    const first = f.service.click(revisionId, true, f.token, ip);
    await vi.waitFor(() => expect(f.billingPosition).toHaveBeenCalledOnce());
    expect(f.rows.get(f.deliveryId)?.status).toBe('CAPTURING');
    await expect(f.service.click(revisionId, true, f.token, ip)).resolves.toBe(
      'https://example.com/',
    );
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
    await f.service.click(revisionId, true, f.token, ip);
    expect(f.priceRead).not.toHaveBeenCalled();
    expect(f.billingPosition).toHaveBeenCalledOnce();
    expect(f.rows.get(f.deliveryId)?.amountPreRaw).toBe('25000000000000000000');
    expect(f.incrementClick).toHaveBeenCalledTimes(3);
  });

  it('keeps USD debt when the contract price is missing despite a fresh database quote', async () => {
    const f = fixture();
    f.chainQuote.preUsdPriceE18 = '0';
    await expect(f.service.click(revisionId, true, f.token, ip)).resolves.toBe(
      'https://example.com/',
    );
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
    expect(f.windows.size).toBe(1);
    const second = f.newDelivery();
    await f.service.click(revisionId, true, second.token, ip);
    expect(f.rows.get(second.deliveryId)?.status).toBe('SUPPRESSED');
    expect(f.totals).toEqual({ billableClicks: 1n, suppressedClicks: 1n });
  });

  it('uses an old contract quote even when the database contains a newer different price', async () => {
    const f = fixture();
    f.chainQuote.preUsdPriceQuotedAt = Math.floor((Date.now() - 31 * 60_000) / 1000).toString();
    f.quote.priceUsd = new Prisma.Decimal('0.02');
    await f.service.click(revisionId, true, f.token, ip);
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
    await expect(f.service.click(revisionId, true, f.token, ip)).resolves.toBe(
      'https://example.com/',
    );
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
    await f.service.click(revisionId, true, f.token, ip);
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
    await f.service.click(revisionId, true, f.token, ip);
    expect(f.rows.get(f.deliveryId)).toMatchObject({
      status: 'SETTLED',
      amountPreRaw: '0',
      captureSource: 'PROJECTION',
      bidBlockNumber: 90n,
    });
    expect(f.claimWindow).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.totalsUpsert).not.toHaveBeenCalled();
  });

  it('keeps legacy, invalid and prefetch links unbilled, with regular analytics intact', async () => {
    const f = fixture();
    await f.service.click(revisionId);
    await f.service.click(revisionId, true, 'invalid');
    await f.service.click(revisionId, false, f.token, ip);
    expect(f.createMany).not.toHaveBeenCalled();
    expect(f.billingPosition).not.toHaveBeenCalled();
    expect(f.incrementClick).toHaveBeenCalledTimes(2);
  });

  it('redirects on database failure and logs only a sanitized capture code', async () => {
    const f = fixture();
    f.createMany.mockRejectedValue(new Error('sensitive database credentials'));
    await expect(f.service.click(revisionId, true, f.token, ip)).resolves.toBe(
      'https://example.com/',
    );
    expect(f.billingPosition).not.toHaveBeenCalled();
    expect(f.logger).toHaveBeenCalledWith({
      event: 'AD_BILLING_CAPTURE_FAILED',
      clickId: f.deliveryId,
      code: 'CAPTURE_FAILED',
    });
    expect(JSON.stringify(f.logger.mock.calls)).not.toContain('sensitive');
  });
});
