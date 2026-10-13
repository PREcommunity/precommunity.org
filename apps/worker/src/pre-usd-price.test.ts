import { Prisma, readLatestPreUsdPrice } from '@precommunity/database';
import { preUsdPriceSnapshot } from '@precommunity/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectPreUsdPrice,
  parsePreUsdQuote,
  PreUsdPriceJobError,
  runPreUsdPriceJob,
} from './pre-usd-price';

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
  const onChecked = vi.fn();
  const run = () =>
    runPreUsdPriceJob(
      database as never,
      redis as never,
      'private-api-key',
      onChecked,
      request,
      now,
    );
  return { database, redis, request, rows, collect, onChecked, run };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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

describe('PRE/USD collector job deadline', () => {
  it.each(['UPDATED', 'UNCHANGED', 'COOLDOWN'] as const)(
    'logs the final quote once and clears the deadline on %s',
    async (outcome) => {
      vi.useFakeTimers();
      const f = fixture();
      if (outcome === 'UNCHANGED') {
        await f.collect();
        f.request.mockResolvedValue(new Response(body()));
      }
      if (outcome === 'COOLDOWN') f.redis.set.mockResolvedValue(null);
      await expect(f.run()).resolves.toMatchObject({ outcome });
      expect(f.onChecked).toHaveBeenCalledOnce();
      expect(f.onChecked.mock.calls[0]![0]).toMatchObject({ outcome });
      if (outcome === 'COOLDOWN') expect(f.onChecked.mock.calls[0]![1]).toBeNull();
      else
        expect(f.onChecked.mock.calls[0]![1]).toMatchObject({
          priceUsd: '0.123456789012345678',
        });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    'REDIS_GATE',
    'REDIS_COOLDOWN',
    'PROVIDER_FETCH',
    'PROVIDER_BODY',
    'QUOTE_READ',
    'QUOTE_SAVE',
    'LOG_READ',
  ] as const)('fails within 30 seconds when %s never settles', async (stage) => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = deferred<never>();
    switch (stage) {
      case 'REDIS_GATE':
        f.redis.set.mockReturnValueOnce(pending.promise);
        break;
      case 'REDIS_COOLDOWN':
        f.redis.set.mockResolvedValue(null);
        f.redis.get.mockReturnValueOnce(pending.promise);
        break;
      case 'PROVIDER_FETCH':
        f.request.mockReturnValueOnce(pending.promise);
        break;
      case 'PROVIDER_BODY': {
        const response = new Response(body());
        vi.spyOn(response, 'text').mockReturnValueOnce(pending.promise);
        f.request.mockResolvedValueOnce(response);
        break;
      }
      case 'QUOTE_READ':
        f.database.preUsdPrice.findFirst.mockReturnValueOnce(pending.promise);
        break;
      case 'QUOTE_SAVE':
        f.database.preUsdPrice.createMany.mockReturnValueOnce(pending.promise);
        break;
      case 'LOG_READ':
        f.database.preUsdPrice.findFirst
          .mockResolvedValueOnce(null)
          .mockReturnValueOnce(pending.promise);
        break;
    }
    const completed = vi.fn();
    const running = f.run().then(completed, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(completed).not.toHaveBeenCalled();
    expect(f.onChecked).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await running;
    expect(error).toBeInstanceOf(PreUsdPriceJobError);
    expect(error).toMatchObject({ code: 'TIMEOUT', stage });
    expect(vi.getTimerCount()).toBe(0);
    if (stage === 'PROVIDER_FETCH' || stage === 'PROVIDER_BODY') {
      expect(f.request.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    }
    // A late dependency rejection remains observed after the race has settled.
    pending.reject(new Error('private-api-key late failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.onChecked).not.toHaveBeenCalled();
  });

  it('does not fetch after a timed-out Redis command eventually acquires the gate', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = deferred<string>();
    f.redis.set.mockReturnValueOnce(pending.promise);
    const running = f.run().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await running).toMatchObject({ code: 'TIMEOUT', stage: 'REDIS_GATE' });
    pending.resolve('OK');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.request).not.toHaveBeenCalled();
    expect(f.database.preUsdPrice.createMany).not.toHaveBeenCalled();
    expect(f.onChecked).not.toHaveBeenCalled();
    await expect(f.run()).resolves.toEqual({ outcome: 'UPDATED' });
    expect(f.onChecked).toHaveBeenCalledOnce();
  });

  it('retains the five-second provider abort and clears the job deadline', async () => {
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
            reject(new Error('private-api-key abort')),
          );
        }),
    );
    const running = f.run().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await running).toMatchObject({ code: 'FAILED', stage: 'PROVIDER_FETCH' });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(5_000);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.onChecked).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not insert after a timed-out quote read eventually completes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = deferred<null>();
    f.database.preUsdPrice.findFirst.mockReturnValueOnce(pending.promise);
    const running = f.run().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await running).toMatchObject({ code: 'TIMEOUT', stage: 'QUOTE_READ' });
    pending.resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.database.preUsdPrice.createMany).not.toHaveBeenCalled();
    expect(f.onChecked).not.toHaveBeenCalled();
  });

  it('does not read for logging after a timed-out insert eventually completes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = deferred<{ count: number }>();
    f.database.preUsdPrice.createMany.mockReturnValueOnce(pending.promise);
    const running = f.run().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await running).toMatchObject({ code: 'TIMEOUT', stage: 'QUOTE_SAVE' });
    pending.resolve({ count: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.database.preUsdPrice.findFirst).toHaveBeenCalledOnce();
    expect(f.onChecked).not.toHaveBeenCalled();
  });

  it('never logs success after a timed-out logging read eventually completes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = deferred<(typeof f.rows)[number] | null>();
    f.database.preUsdPrice.findFirst
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(pending.promise);
    const running = f.run().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await running).toMatchObject({ code: 'TIMEOUT', stage: 'LOG_READ' });
    pending.resolve(f.rows[0]!);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.onChecked).not.toHaveBeenCalled();
  });

  it.each(['REDIS_GATE', 'PROVIDER_FETCH', 'QUOTE_READ', 'LOG_READ', 'LOG'] as const)(
    'reports only a safe stage on failure at %s and clears its deadline',
    async (stage) => {
      vi.useFakeTimers();
      const f = fixture();
      const secret = new Error('private-api-key https://user:password@provider.test');
      if (stage === 'REDIS_GATE') f.redis.set.mockRejectedValueOnce(secret);
      if (stage === 'PROVIDER_FETCH') f.request.mockRejectedValueOnce(secret);
      if (stage === 'QUOTE_READ') f.database.preUsdPrice.findFirst.mockRejectedValueOnce(secret);
      if (stage === 'LOG_READ')
        f.database.preUsdPrice.findFirst.mockResolvedValueOnce(null).mockRejectedValueOnce(secret);
      if (stage === 'LOG')
        f.onChecked.mockImplementationOnce(() => {
          throw secret;
        });
      const error = await f.run().catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(PreUsdPriceJobError);
      expect(error).toMatchObject({ code: 'FAILED', stage });
      expect((error as Error).message).not.toContain('private-api-key');
      expect((error as Error).message).not.toContain('provider.test');
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
