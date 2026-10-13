import { Logger } from '@nestjs/common';
import { PrismaClient, createPrismaAdapter } from '@precommunity/database';
import { adKeywordId } from '@precommunity/shared';
import Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimClickBillingWindow } from '../src/ads/ads-click-billing';
import { signAdDelivery } from '../src/ads/ads-delivery';
import { AdsResolveRateLimitService } from '../src/ads/ads-resolve-rate-limit.service';
import { AdsService } from '../src/ads/ads.service';
import { config } from '../src/config';

// Services are supplied by the operator or CI; only this test's schema and keys are modified.
const schema = `ads_security_${randomUUID().replaceAll('-', '')}`;
const keyHash = createHash('sha256').update(schema).digest('hex');
const otherKeyHash = createHash('sha256').update(`${schema}:other`).digest('hex');
const redisKey = `precommunity:ads:resolve:limit:v2:${config.deployment.chainId}:${keyHash}`;
const otherRedisKey = `precommunity:ads:resolve:limit:v2:${config.deployment.chainId}:${otherKeyHash}`;
let limiters: AdsResolveRateLimitService[] = [];
let admin: PrismaClient;
let databases: PrismaClient[] = [];
let redisClients: Redis[] = [];
let schemaCreated = false;
const context = {
  revisionId: randomUUID(),
  chainId: 84532,
  contractAddress: `0x${'1'.repeat(40)}`,
  keywordId: adKeywordId('bitcoin'),
  keyword: 'bitcoin',
  stakerAddress: `0x${'2'.repeat(40)}`,
  positionVersion: '1',
};
const campaignId = randomUUID();

function service(database: PrismaClient) {
  return new AdsService(
    {
      adCreativeRevision: {
        findFirst: async () => ({ campaignId, destinationUrl: 'https://example.com/' }),
      },
      adBillingClick: database.adBillingClick,
      $transaction: database.$transaction.bind(database),
    } as never,
    { incrementClick: async () => true } as never,
    {
      billingPosition: async () => ({
        status: 'FOUND',
        bidUsdRaw: '100000',
        source: 'RPC',
        blockNumber: 100n,
        blockHash: `0x${'3'.repeat(64)}`,
        preUsdPriceE18: '10000000000000000',
        preUsdPriceQuotedAt: Math.floor(Date.now() / 1000).toString(),
      }),
    } as never,
  );
}

beforeAll(async () => {
  const databaseUrl = process.env.TEST_ADS_DATABASE_URL;
  const redisUrl = process.env.TEST_ADS_REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      'Provide TEST_ADS_DATABASE_URL and TEST_ADS_REDIS_URL for existing test services',
    );
  }
  if (config.REDIS_URL !== redisUrl) {
    throw new Error('The integration limiter must use TEST_ADS_REDIS_URL');
  }
  for (const value of [databaseUrl, redisUrl]) {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)) {
      throw new Error('Ads security integration tests require loopback service URLs');
    }
  }
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  admin = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.searchParams.set('schema', schema);
  databases = [0, 1].map(
    () => new PrismaClient({ adapter: createPrismaAdapter(isolatedUrl.toString()) }),
  );
  const clickTable = readFileSync(
    new URL(
      '../../../packages/database/prisma/migrations/20261011120000_ad_click_charges/migration.sql',
      import.meta.url,
    ),
    'utf8',
  ).split(';')[0]!;
  await databases[0]!.$executeRawUnsafe(clickTable);
  const priceColumns = readFileSync(
    new URL(
      '../../../packages/database/prisma/migrations/20261012143000_keyword_market_price_publication/migration.sql',
      import.meta.url,
    ),
    'utf8',
  )
    .split(';')
    .find((statement) => statement.includes('ALTER TABLE "AdBillingClick"'))!;
  await databases[0]!.$executeRawUnsafe(priceColumns);
  for (const migration of [
    '20261013150000_ad_billing_click_windows',
    '20261013170000_ad_billing_click_totals',
  ]) {
    const sql = readFileSync(
      new URL(
        `../../../packages/database/prisma/migrations/${migration}/migration.sql`,
        import.meta.url,
      ),
      'utf8',
    );
    for (const statement of sql.split(';').filter((value) => value.trim())) {
      await databases[0]!.$executeRawUnsafe(statement);
    }
  }
  redisClients = [0, 1].map(
    () =>
      new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        connectTimeout: 1_000,
        commandTimeout: 2_000,
      }),
  );
  await Promise.all(redisClients.map((client) => client.connect()));
  limiters = [new AdsResolveRateLimitService(), new AdsResolveRateLimitService()];
});

beforeEach(async () => {
  await databases[0]!.adBillingClick.deleteMany();
  await databases[0]!.adBillingClickWindow.deleteMany();
  await databases[0]!.adBillingClickTotals.deleteMany();
  await redisClients[0]!.del(redisKey, otherRedisKey);
});

afterAll(async () => {
  try {
    if (redisClients[0]?.status === 'ready') await redisClients[0].del(redisKey, otherRedisKey);
  } finally {
    limiters.forEach((limiter) => limiter.onModuleDestroy());
    redisClients.forEach((client) => client.disconnect());
    await Promise.all(databases.map((database) => database.$disconnect()));
    if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.$disconnect();
    vi.restoreAllMocks();
  }
});

describe('ads security with PostgreSQL and Redis', () => {
  it('records one debt across concurrent API instances and keeps suppressed deliveries nonbilling on replay', async () => {
    const services = databases.map(service);
    const tokens = Array.from({ length: 12 }, () =>
      signAdDelivery(context, config.ADS_DELIVERY_SECRET),
    );
    await Promise.all(
      tokens.map((token, index) =>
        services[index % 2]!.click(context.revisionId, true, token, '192.0.2.1'),
      ),
    );
    const rows = await databases[0]!.adBillingClick.findMany();
    expect(rows.filter((row) => row.status === 'PENDING')).toHaveLength(1);
    expect(rows.filter((row) => row.status === 'SUPPRESSED')).toHaveLength(11);
    expect(rows.filter((row) => row.status === 'PENDING')[0]?.amountPreRaw).toBe(
      '10000000000000000000',
    );
    const suppressed = rows.find((row) => row.status === 'SUPPRESSED')!;
    const token = tokens.find(
      (value) =>
        JSON.parse(Buffer.from(value.split('.')[0]!, 'base64url').toString()).deliveryId ===
        suppressed.id,
    )!;
    await services[1]!.click(context.revisionId, true, token, '192.0.2.2');
    expect(await databases[0]!.adBillingClick.count({ where: { status: 'PENDING' } })).toBe(1);
    expect(await databases[0]!.adBillingClickWindow.count()).toBe(1);
    const totals = () =>
      databases[0]!.adBillingClickTotals.findUnique({
        where: {
          chainId_contractAddress: {
            chainId: context.chainId,
            contractAddress: context.contractAddress,
          },
        },
        select: { billableClicks: true, suppressedClicks: true },
      });
    expect(await totals()).toEqual({ billableClicks: 1n, suppressedClicks: 11n });
    await databases[0]!.adBillingClick.deleteMany({ where: { status: 'SUPPRESSED' } });
    expect(await totals()).toEqual({ billableClicks: 1n, suppressedClicks: 11n });
  });

  it('rolls back a failed totals write and counts simultaneous first clicks from different IPs', async () => {
    const api = service(databases[0]!);
    await databases[0]!.$executeRawUnsafe(
      `ALTER TABLE "AdBillingClickTotals" ADD CONSTRAINT "test_totals_write_failure" CHECK ("billableClicks" = 0)`,
    );
    try {
      await expect(
        api.click(
          context.revisionId,
          true,
          signAdDelivery(context, config.ADS_DELIVERY_SECRET),
          '192.0.2.1',
        ),
      ).resolves.toBe('https://example.com/');
      expect(await databases[0]!.adBillingClickWindow.count()).toBe(0);
      expect(await databases[0]!.adBillingClickTotals.count()).toBe(0);
      expect(await databases[0]!.adBillingClick.count({ where: { status: 'UNBILLED' } })).toBe(1);
    } finally {
      await databases[0]!.$executeRawUnsafe(
        `ALTER TABLE "AdBillingClickTotals" DROP CONSTRAINT "test_totals_write_failure"`,
      );
    }
    await Promise.all(
      databases.map((database, index) =>
        service(database).click(
          context.revisionId,
          true,
          signAdDelivery(context, config.ADS_DELIVERY_SECRET),
          `192.0.2.${index + 1}`,
        ),
      ),
    );
    expect(await databases[0]!.adBillingClick.count({ where: { status: 'PENDING' } })).toBe(2);
    const totals = await databases[0]!.adBillingClickTotals.findFirst();
    expect(totals).toMatchObject({ billableClicks: 2n, suppressedClicks: 0n });
  });

  it('allows a fresh delivery after the rolling window expires and rolls back abandoned window claims', async () => {
    const api = service(databases[0]!);
    await api.click(
      context.revisionId,
      true,
      signAdDelivery(context, config.ADS_DELIVERY_SECRET),
      '192.0.2.1',
    );
    await databases[0]!.adBillingClickWindow.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await api.click(
      context.revisionId,
      true,
      signAdDelivery(context, config.ADS_DELIVERY_SECRET),
      '192.0.2.1',
    );
    expect(await databases[0]!.adBillingClick.count({ where: { status: 'PENDING' } })).toBe(2);
    await expect(
      databases[1]!.$transaction(async (transaction) => {
        expect(await claimClickBillingWindow(transaction, 'rollback-test')).toBe(true);
        const [window] = await transaction.$queryRaw<Array<{ fiveMinuteWindow: boolean }>>`
          SELECT "expiresAt" = (CURRENT_TIMESTAMP + INTERVAL '5 minutes')::timestamptz(3)
            AS "fiveMinuteWindow"
          FROM "AdBillingClickWindow" WHERE "fingerprint" = 'rollback-test'
        `;
        expect(window?.fiveMinuteWindow).toBe(true);
        throw new Error('Abandoned capture');
      }),
    ).rejects.toThrow('Abandoned capture');
    expect(
      await databases[0]!.adBillingClickWindow.findUnique({
        where: { fingerprint: 'rollback-test' },
      }),
    ).toBeNull();
  });

  it('shares a sixty-request window across instances, resets on expiry and preserves billing protection after limiter state loss', async () => {
    const redis = redisClients[0]!;
    const results = await Promise.all(
      Array.from({ length: 120 }, (_, index) => limiters[index % 2]!.consume(keyHash)),
    );
    expect(results.filter((result) => result === 0)).toHaveLength(60);
    expect(results.filter((result) => result > 0)).toHaveLength(60);
    expect(results.filter((result) => result > 0).every((result) => result <= 1_000)).toBe(true);
    expect(await limiters[0]!.consume(otherKeyHash)).toBe(0);
    const ttl = await redis.pttl(redisKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1_000);
    await expect
      .poll(() => limiters[0]!.consume(keyHash), { timeout: 2_500, interval: 20 })
      .toBe(0);

    const api = service(databases[0]!);
    await api.click(
      context.revisionId,
      true,
      signAdDelivery(context, config.ADS_DELIVERY_SECRET),
      '192.0.2.1',
    );
    await redis.del(redisKey);
    expect(await limiters[0]!.consume(keyHash)).toBe(0);
    await api.click(
      context.revisionId,
      true,
      signAdDelivery(context, config.ADS_DELIVERY_SECRET),
      '192.0.2.1',
    );
    expect(await databases[0]!.adBillingClick.count({ where: { status: 'PENDING' } })).toBe(1);
    expect(await databases[0]!.adBillingClick.count({ where: { status: 'SUPPRESSED' } })).toBe(1);
  });
});
