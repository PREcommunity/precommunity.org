import { Prisma, readLatestPreUsdPrice, type PrismaClient } from '@precommunity/database';
import {
  PRE_USD_PRICE_COOLDOWN_MS,
  type PreUsdPriceRefreshResult,
  type PreUsdQuote,
} from '@precommunity/shared';
import type IORedis from 'ioredis';

const attemptKey = 'precommunity:pre-usd-price:next-attempt';
const endpoint =
  'https://api.coingecko.com/api/v3/simple/price?ids=presearch&vs_currencies=usd&include_last_updated_at=true&precision=18';
const jobTimeoutMs = 30_000;

type PriceJobStage =
  | 'REDIS_GATE'
  | 'REDIS_COOLDOWN'
  | 'PROVIDER_FETCH'
  | 'PROVIDER_BODY'
  | 'QUOTE_PARSE'
  | 'QUOTE_READ'
  | 'QUOTE_SAVE'
  | 'LOG_READ'
  | 'LOG';

export class PreUsdPriceJobError extends Error {
  constructor(
    readonly code: 'TIMEOUT' | 'FAILED',
    readonly stage: PriceJobStage,
  ) {
    super(`PRE/USD price collection ${code.toLowerCase()} at ${stage}`);
    this.name = 'PreUsdPriceJobError';
  }
}

interface PriceJobControl {
  signal: AbortSignal;
  stage: (stage: PriceJobStage) => void;
}

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
  control?: PriceJobControl,
): Promise<PreUsdPriceRefreshResult> {
  const retryAt = new Date(now.getTime() + PRE_USD_PRICE_COOLDOWN_MS).toISOString();
  control?.stage('REDIS_GATE');
  const acquired = await redis.set(attemptKey, retryAt, 'PX', PRE_USD_PRICE_COOLDOWN_MS, 'NX');
  if (!acquired) {
    control?.stage('REDIS_COOLDOWN');
    return { outcome: 'COOLDOWN', retryAt: (await redis.get(attemptKey)) ?? retryAt };
  }

  let response: Response;
  let body: string;
  try {
    control?.stage('PROVIDER_FETCH');
    const requestTimeout = AbortSignal.timeout(5_000);
    response = await request(endpoint, {
      headers: { 'x-cg-demo-api-key': apiKey },
      signal: control ? AbortSignal.any([requestTimeout, control.signal]) : requestTimeout,
      redirect: 'error',
    });
    control?.stage('PROVIDER_BODY');
    if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
    body = await response.text();
  } catch {
    throw new Error('CoinGecko price request failed or timed out');
  }
  control?.stage('QUOTE_PARSE');
  const quote = parsePreUsdQuote(body, now);
  control?.stage('QUOTE_READ');
  const latest = await database.preUsdPrice.findFirst({
    where: { source: 'COINGECKO', assetId: 'presearch' },
    orderBy: { quotedAt: 'desc' },
    select: { quotedAt: true },
  });
  control?.stage('QUOTE_SAVE');
  const saved = await database.preUsdPrice.createMany({
    data: { source: 'COINGECKO', assetId: 'presearch', ...quote, fetchedAt: new Date() },
    skipDuplicates: true,
  });
  return {
    outcome:
      saved.count > 0 && (!latest || quote.quotedAt > latest.quotedAt) ? 'UPDATED' : 'UNCHANGED',
  };
}

export async function runPreUsdPriceJob(
  database: Pick<PrismaClient, 'preUsdPrice'>,
  redis: Pick<IORedis, 'set' | 'get'>,
  apiKey: string,
  onChecked: (result: PreUsdPriceRefreshResult, quote: PreUsdQuote | null) => void,
  request: typeof fetch = fetch,
  now = new Date(),
): Promise<PreUsdPriceRefreshResult> {
  const controller = new AbortController();
  let stage: PriceJobStage = 'REDIS_GATE';
  const control: PriceJobControl = {
    signal: controller.signal,
    stage(next) {
      // shortcut: in-flight Redis/Prisma calls cannot be cancelled; use driver deadlines if they accumulate.
      controller.signal.throwIfAborted();
      stage = next;
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new PreUsdPriceJobError('TIMEOUT', stage);
      controller.abort(error);
      reject(error);
    }, jobTimeoutMs);
  });
  const work = (async () => {
    const result = await collectPreUsdPrice(database, redis, apiKey, request, now, control);
    control.stage('LOG_READ');
    const quote = await readLatestPreUsdPrice(database);
    control.stage('LOG');
    onChecked(result, quote);
    return result;
  })();
  try {
    return await Promise.race([work, deadline]);
  } catch {
    const error = controller.signal.aborted
      ? (controller.signal.reason as PreUsdPriceJobError)
      : new PreUsdPriceJobError('FAILED', stage);
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
