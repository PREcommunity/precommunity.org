import { Prisma, type PrismaClient } from '@precommunity/database';
import { PRE_USD_PRICE_COOLDOWN_MS, type PreUsdPriceRefreshResult } from '@precommunity/shared';
import type IORedis from 'ioredis';

const attemptKey = 'precommunity:pre-usd-price:next-attempt';
const endpoint =
  'https://api.coingecko.com/api/v3/simple/price?ids=presearch&vs_currencies=usd&include_last_updated_at=true&precision=18';

class JsonNumber {
  constructor(readonly source: string) {}
}

export function parsePreUsdQuote(body: string, now = new Date()) {
  let payload: unknown;
  try {
    // Node 22 preserves the original JSON number here, before floating-point rounding.
    const parse = JSON.parse as (
      text: string,
      reviver: (key: string, value: unknown, context?: { source?: string }) => unknown,
    ) => unknown;
    payload = parse(body, (_key, value, context) => {
      if (typeof value !== 'number') return value;
      if (!context?.source) throw new Error('Exact JSON numbers unavailable');
      return new JsonNumber(context.source);
    });
  } catch {
    throw new Error('CoinGecko returned invalid price data');
  }
  const quote = (payload as { presearch?: { usd?: unknown; last_updated_at?: unknown } } | null)
    ?.presearch;
  if (!(quote?.usd instanceof JsonNumber) || !(quote.last_updated_at instanceof JsonNumber)) {
    throw new Error('CoinGecko returned invalid price data');
  }
  const priceUsd = new Prisma.Decimal(quote.usd.source);
  const seconds = Number(quote.last_updated_at.source);
  if (
    !priceUsd.isFinite() ||
    priceUsd.lte(0) ||
    priceUsd.gte('1e20') ||
    priceUsd.decimalPlaces() > 18 ||
    !/^\d+$/.test(quote.last_updated_at.source) ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    seconds * 1000 > now.getTime() + 60_000
  ) {
    throw new Error('CoinGecko returned invalid price data');
  }
  return { priceUsd, quotedAt: new Date(seconds * 1000) };
}

export async function collectPreUsdPrice(
  database: Pick<PrismaClient, 'preUsdPrice'>,
  redis: Pick<IORedis, 'set' | 'get'>,
  apiKey: string,
  request: typeof fetch = fetch,
  now = new Date(),
): Promise<PreUsdPriceRefreshResult> {
  const retryAt = new Date(now.getTime() + PRE_USD_PRICE_COOLDOWN_MS).toISOString();
  const acquired = await redis.set(attemptKey, retryAt, 'PX', PRE_USD_PRICE_COOLDOWN_MS, 'NX');
  if (!acquired) {
    return { outcome: 'COOLDOWN', retryAt: (await redis.get(attemptKey)) ?? retryAt };
  }

  let response: Response;
  let body: string;
  try {
    response = await request(endpoint, {
      headers: { 'x-cg-demo-api-key': apiKey },
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
    body = await response.text();
  } catch {
    throw new Error('CoinGecko price request failed or timed out');
  }
  const quote = parsePreUsdQuote(body, now);
  const latest = await database.preUsdPrice.findFirst({
    where: { source: 'COINGECKO', assetId: 'presearch' },
    orderBy: { quotedAt: 'desc' },
    select: { quotedAt: true },
  });
  const saved = await database.preUsdPrice.createMany({
    data: { source: 'COINGECKO', assetId: 'presearch', ...quote, fetchedAt: new Date() },
    skipDuplicates: true,
  });
  return {
    outcome:
      saved.count > 0 && (!latest || quote.quotedAt > latest.quotedAt) ? 'UPDATED' : 'UNCHANGED',
  };
}
