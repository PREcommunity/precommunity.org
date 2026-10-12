import { Prisma, readLatestPreUsdPrice } from '@precommunity/database';
import { preUsdPriceSnapshot } from '@precommunity/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPreUsdPrice, parsePreUsdQuote } from './pre-usd-price';

const now = new Date('2026-10-09T10:00:00.000Z');
const timestamp = Math.floor(now.getTime() / 1000);
const body = (price = '0.123456789012345678', time: number | string = timestamp) =>
  `{"presearch":{"usd":${price},"last_updated_at":${time}}}`;

function fixture() {
  const rows: Array<{
    id: string;
    source: string;
    assetId: string;
    priceUsd: Prisma.Decimal;
    quotedAt: Date;
    fetchedAt: Date;
  }> = [];
  const database = {
    preUsdPrice: {
      findFirst: vi.fn(
        async () =>
          rows.slice().sort((a, b) => b.quotedAt.getTime() - a.quotedAt.getTime())[0] ?? null,
      ),
      createMany: vi.fn(async ({ data }: { data: Omit<(typeof rows)[number], 'id'> }) => {
        if (rows.some((row) => row.quotedAt.getTime() === data.quotedAt.getTime()))
          return { count: 0 };
        rows.push({ ...data, id: `quote-${rows.length}` });
        return { count: 1 };
      }),
    },
  };
  const redis = { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null) };
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body()));
  const collect = (at = now) =>
    collectPreUsdPrice(database as never, redis as never, 'private-api-key', request, at);
  return { database, redis, request, rows, collect };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CoinGecko PRE/USD parser', () => {
  it('preserves original JSON number precision and supports scientific notation', () => {
    expect(parsePreUsdQuote(body(), now).priceUsd.toFixed()).toBe('0.123456789012345678');
    expect(parsePreUsdQuote(body('5.57e-4'), now).priceUsd.toFixed()).toBe('0.000557');
    expect(parsePreUsdQuote(body(), now).quotedAt).toEqual(now);
  });
  it.each([
    '0',
    '-1',
    '1e20',
    '1e999',
    '0.1234567890123456789',
    '1e-19',
    '"0.1"',
    'null',
    '{"source":"0.1"}',
  ])('rejects invalid/unrepresentable price %s', (price) => {
    expect(() => parsePreUsdQuote(body(price), now)).toThrow('invalid price data');
  });
  it.each([
    'broken',
    '{}',
    'null',
    '{"presearch":null}',
    '{"bitcoin":{"usd":1,"last_updated_at":1}}',
  ])('rejects malformed or missing data %s', (data) => {
    expect(() => parsePreUsdQuote(data, now)).toThrow('invalid price data');
  });
  it.each([0, -1, timestamp + 61, '"1"', '1.5', 'null', '1e99'])(
    'rejects invalid timestamp %s',
    (time) => {
      expect(() => parsePreUsdQuote(body('0.1', time), now)).toThrow('invalid price data');
    },
  );
  it('allows exactly one minute of provider clock skew', () => {
    expect(parsePreUsdQuote(body('0.1', timestamp + 60), now).quotedAt.getTime()).toBe(
      now.getTime() + 60_000,
    );
  });
});

describe('PRE/USD collector', () => {
  it('saves a validated quote without rounding and reads it through the shared database helper', async () => {
    const f = fixture();
    await expect(f.collect()).resolves.toEqual({ outcome: 'UPDATED' });
    const quote = await readLatestPreUsdPrice(f.database as never);
    expect(quote?.priceUsd).toBe('0.123456789012345678');
    expect(quote?.quotedAt).toBe(now.toISOString());
    expect(f.database.preUsdPrice.findFirst).toHaveBeenLastCalledWith({
      where: { source: 'COINGECKO', assetId: 'presearch' },
      orderBy: { quotedAt: 'desc' },
    });
    const [url, options] = f.request.mock.calls[0]!;
    const params = new URL(String(url)).searchParams;
    expect(params.get('ids')).toBe('presearch');
    expect(params.get('vs_currencies')).toBe('usd');
    expect(params.get('include_last_updated_at')).toBe('true');
    expect(params.get('precision')).toBe('18');
    expect(options?.headers).toEqual({ 'x-cg-demo-api-key': 'private-api-key' });
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(f.database.preUsdPrice.createMany.mock.calls[0]![0]).toMatchObject({
      skipDuplicates: true,
    });
  });
  it('deduplicates old responses without replacing price or refreshing quote/fetch times', async () => {
    const f = fixture();
    await f.collect();
    const first = structuredClone({ fetchedAt: f.rows[0]!.fetchedAt });
    f.request.mockResolvedValue(new Response(body('0.2')));
    await expect(f.collect(new Date(now.getTime() + 31 * 60_000))).resolves.toEqual({
      outcome: 'UNCHANGED',
    });
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]!.fetchedAt).toEqual(first.fetchedAt);
    const quote = await readLatestPreUsdPrice(f.database as never);
    expect(preUsdPriceSnapshot(quote, new Date(now.getTime() + 31 * 60_000)).status).toBe('STALE');
    expect(quote?.priceUsd).toBe('0.123456789012345678');
  });
  it('retains older out-of-order quotes without presenting them as an update', async () => {
    const f = fixture();
    await f.collect();
    f.request.mockResolvedValue(new Response(body('0.1', timestamp - 60)));
    await expect(f.collect()).resolves.toEqual({ outcome: 'UNCHANGED' });
    expect(f.rows).toHaveLength(2);
    expect((await readLatestPreUsdPrice(f.database as never))?.quotedAt).toBe(now.toISOString());
  });
  it('uses an atomic shared gate so simultaneous jobs make only one provider call', async () => {
    const f = fixture();
    f.redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    f.redis.get.mockResolvedValue(new Date(now.getTime() + 60_000).toISOString());
    const results = await Promise.all([f.collect(), f.collect()]);
    expect(results.map((result) => result.outcome)).toEqual(['UPDATED', 'COOLDOWN']);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.redis.set).toHaveBeenCalledWith(
      'precommunity:pre-usd-price:next-attempt',
      new Date(now.getTime() + 60_000).toISOString(),
      'PX',
      60_000,
      'NX',
    );
  });
  it.each([429, 500, 503])(
    'preserves prior quotes and consumes one attempt on HTTP %s',
    async (status) => {
      const f = fixture();
      await f.collect();
      f.request.mockResolvedValue(new Response('upstream body private-api-key', { status }));
      f.request.mockClear();
      f.database.preUsdPrice.createMany.mockClear();
      await expect(f.collect()).rejects.toThrow('CoinGecko price request failed or timed out');
      expect(f.request).toHaveBeenCalledOnce();
      expect(f.database.preUsdPrice.createMany).not.toHaveBeenCalled();
      expect(f.rows).toHaveLength(1);
    },
  );
  it('aborts the request after five seconds without retrying or leaking upstream errors', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const f = fixture();
    f.request.mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('private-api-key timeout')),
          );
        }),
    );
    const check = expect(f.collect()).rejects.toThrow(
      'CoinGecko price request failed or timed out',
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await check;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(5_000);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.database.preUsdPrice.createMany).not.toHaveBeenCalled();
  });
  it('never persists malformed data or fetches when the Redis gate is unavailable', async () => {
    const f = fixture();
    f.request.mockResolvedValue(new Response(body('0')));
    await expect(f.collect()).rejects.toThrow('invalid price data');
    expect(f.database.preUsdPrice.createMany).not.toHaveBeenCalled();
    f.request.mockClear();
    f.redis.set.mockRejectedValue(new Error('Redis unavailable'));
    await expect(f.collect()).rejects.toThrow('Redis unavailable');
    expect(f.request).not.toHaveBeenCalled();
  });
});
