import 'reflect-metadata';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { readLatestPreUsdPrice } from '@precommunity/database';
import {
  PRE_USD_PRICE_JOB,
  PRE_USD_PRICE_MANUAL_JOB,
  PRE_USD_PRICE_QUEUE,
} from '@precommunity/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../common/prisma.service';
import { PreUsdPriceService } from './pre-usd-price.service';

const mocks = vi.hoisted(() => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    COINGECKO_API_KEY: 'test-key' as string | undefined,
    deployment: { chainId: 84532 },
    chain: { id: 84532 },
    BASE_RPC_URL: 'https://private-rpc.example/?key=private-fixture',
    adsContract: { address: null as string | null },
  },
  queue: { add: vi.fn(), getJob: vi.fn(), on: vi.fn(), close: vi.fn(), waitUntilReady: vi.fn() },
  redis: { on: vi.fn(), disconnect: vi.fn() },
  queueConstructor: vi.fn(),
  redisConstructor: vi.fn(),
  indexedPrice: vi.fn(),
  publication: vi.fn(),
  chargeSettings: vi.fn(),
  rpc: { getChainId: vi.fn(), getBalance: vi.fn() },
  client: vi.fn(),
  transport: vi.fn(),
}));
vi.mock('../config', () => ({ config: mocks.config }));
vi.mock('../common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('@precommunity/database', () => ({ readLatestPreUsdPrice: vi.fn() }));
vi.mock('viem', async (original) => ({
  ...(await original<typeof import('viem')>()),
  createPublicClient: (...args: unknown[]) => {
    mocks.client(...args);
    return mocks.rpc;
  },
  http: (...args: unknown[]) => {
    mocks.transport(...args);
    return 'fixture-transport';
  },
}));
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(...args: unknown[]) {
      mocks.queueConstructor(...args);
      return mocks.queue;
    }
  },
}));
vi.mock('ioredis', () => ({
  default: class {
    constructor(...args: unknown[]) {
      mocks.redisConstructor(...args);
      return mocks.redis;
    }
  },
}));

const jobId = '564d4403-9a2d-480e-a3d8-fdabf2f0e5a7';
const quote = {
  id: 'quote-id',
  source: 'COINGECKO' as const,
  assetId: 'presearch' as const,
  priceUsd: '0.123456789012345678',
  quotedAt: '2026-10-09T10:00:00.000Z',
  fetchedAt: '2026-10-09T10:01:00.000Z',
};

function fixture() {
  const prisma = {
    adIndexerState: { findUnique: mocks.indexedPrice },
    adPricePublication: { findFirst: mocks.publication },
    adChargeSettings: { findUnique: mocks.chargeSettings },
  } as unknown as PrismaService;
  return { prisma, service: new PreUsdPriceService(prisma) };
}

describe('admin PRE/USD price service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.config.COINGECKO_API_KEY = 'test-key';
    mocks.config.adsContract.address = null;
    mocks.config.deployment.chainId = 84532;
    mocks.config.chain.id = 84532;
    mocks.rpc.getChainId.mockResolvedValue(84532);
    mocks.rpc.getBalance.mockResolvedValue(0n);
    mocks.indexedPrice.mockResolvedValue(null);
    mocks.publication.mockResolvedValue(null);
    mocks.chargeSettings.mockResolvedValue(null);
    mocks.queue.add.mockResolvedValue({ id: jobId });
    mocks.queue.close.mockResolvedValue(undefined);
    mocks.queue.waitUntilReady.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('reads the database quote with exact precision and no queue activity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T10:20:00.000Z'));
    vi.mocked(readLatestPreUsdPrice).mockResolvedValue(quote);
    const { prisma, service } = fixture();

    await expect(service.latest()).resolves.toMatchObject({
      status: 'FRESH',
      quote,
      collectorEnabled: true,
    });
    expect(readLatestPreUsdPrice).toHaveBeenCalledWith(prisma);
    expect(mocks.queueConstructor).not.toHaveBeenCalled();
  });

  it('keeps stale prices visible without treating repeated fetch time as freshness', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T10:40:00.000Z'));
    vi.mocked(readLatestPreUsdPrice).mockResolvedValue({
      ...quote,
      fetchedAt: '2026-10-09T10:39:00.000Z',
    });
    const result = await fixture().service.latest();
    expect(result.status).toBe('STALE');
    expect(result.quote?.priceUsd).toBe(quote.priceUsd);
  });

  it('reports missing data and disabled collection without contacting Redis', async () => {
    mocks.config.COINGECKO_API_KEY = undefined;
    vi.mocked(readLatestPreUsdPrice).mockResolvedValue(null);
    await expect(fixture().service.latest()).resolves.toMatchObject({
      status: 'MISSING',
      quote: null,
      collectorEnabled: false,
    });
    expect(mocks.queueConstructor).not.toHaveBeenCalled();
  });

  it('enqueues manual work with a UUID and shares an existing deduplicated job ID', async () => {
    const { service } = fixture();
    await expect(service.refresh()).resolves.toEqual({ jobId });
    await expect(service.refresh()).resolves.toEqual({ jobId });
    expect(mocks.queueConstructor).toHaveBeenCalledOnce();
    expect(mocks.queueConstructor).toHaveBeenCalledWith(PRE_USD_PRICE_QUEUE, {
      connection: mocks.redis,
    });
    expect(mocks.redisConstructor).toHaveBeenCalledWith(
      mocks.config.REDIS_URL,
      expect.objectContaining({
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 5_000,
        connectTimeout: 5_000,
      }),
    );
    for (const call of mocks.queue.add.mock.calls) {
      expect(call).toEqual([
        PRE_USD_PRICE_MANUAL_JOB,
        {},
        {
          jobId: expect.stringMatching(
            /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
          ),
          deduplication: { id: PRE_USD_PRICE_MANUAL_JOB },
          attempts: 1,
          removeOnComplete: 20,
          removeOnFail: 100,
        },
      ]);
    }
    expect(mocks.queue.add.mock.calls[0]?.[2].jobId).not.toBe(
      mocks.queue.add.mock.calls[1]?.[2].jobId,
    );
    expect(readLatestPreUsdPrice).not.toHaveBeenCalled();
  });

  it('rejects unconfigured updates before creating a queue', async () => {
    mocks.config.COINGECKO_API_KEY = undefined;
    await expect(fixture().service.refresh()).rejects.toThrow(
      'PRE/USD price updates are not configured',
    );
    expect(mocks.queueConstructor).not.toHaveBeenCalled();
  });

  it('returns a safe unavailable response for Redis failures', async () => {
    mocks.queue.add.mockRejectedValue(new Error('redis://secret-user:secret-key@example.test'));
    await expect(fixture().service.refresh()).rejects.toThrow(
      'PRE/USD price update queue is unavailable',
    );
  });

  it('bounds queue requests while Redis is reconnecting', async () => {
    vi.useFakeTimers();
    mocks.queue.add.mockImplementation(() => new Promise(() => undefined));
    const operation = fixture().service.refresh();
    const check = expect(operation).rejects.toBeInstanceOf(ServiceUnavailableException);
    await vi.advanceTimersByTimeAsync(5_000);
    await check;
  });

  it('does not enqueue after an initial connection times out and later becomes ready', async () => {
    vi.useFakeTimers();
    let connected!: () => void;
    mocks.queue.waitUntilReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          connected = resolve;
        }),
    );
    const operation = fixture().service.refresh();
    const check = expect(operation).rejects.toBeInstanceOf(ServiceUnavailableException);
    await vi.advanceTimersByTimeAsync(5_000);
    await check;
    connected();
    await Promise.resolve();
    expect(mocks.queue.add).not.toHaveBeenCalled();
  });

  it.each([
    ['waiting', 'QUEUED'],
    ['delayed', 'QUEUED'],
    ['active', 'RUNNING'],
    ['failed', 'FAILED'],
  ])('maps %s without exposing provider or Redis failure details', async (state, status) => {
    mocks.queue.getJob.mockResolvedValue({
      name: PRE_USD_PRICE_MANUAL_JOB,
      getState: vi.fn().mockResolvedValue(state),
      failedReason: 'secret API key in upstream error',
      returnvalue: { hidden: 'secret' },
    });
    await expect(fixture().service.refreshStatus(jobId)).resolves.toEqual({
      jobId,
      status,
      result: null,
    });
  });

  it.each(['UPDATED', 'UNCHANGED'])(
    'returns the %s result without extra worker fields',
    async (outcome) => {
      mocks.queue.getJob.mockResolvedValue({
        name: PRE_USD_PRICE_MANUAL_JOB,
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { outcome, hidden: 'secret' },
      });
      await expect(fixture().service.refreshStatus(jobId)).resolves.toEqual({
        jobId,
        status: 'COMPLETED',
        result: { outcome },
      });
    },
  );

  it('returns a valid cooldown timestamp for the manual update message', async () => {
    mocks.queue.getJob.mockResolvedValue({
      name: PRE_USD_PRICE_MANUAL_JOB,
      getState: vi.fn().mockResolvedValue('completed'),
      returnvalue: { outcome: 'COOLDOWN', retryAt: '2026-10-09T10:01:00.000Z' },
    });
    await expect(fixture().service.refreshStatus(jobId)).resolves.toEqual({
      jobId,
      status: 'COMPLETED',
      result: { outcome: 'COOLDOWN', retryAt: '2026-10-09T10:01:00.000Z' },
    });
  });

  it('treats unexpected completed results as failed without returning them', async () => {
    mocks.queue.getJob.mockResolvedValue({
      name: PRE_USD_PRICE_MANUAL_JOB,
      getState: vi.fn().mockResolvedValue('completed'),
      returnvalue: { outcome: 'COOLDOWN', retryAt: 'secret' },
    });
    await expect(fixture().service.refreshStatus(jobId)).resolves.toEqual({
      jobId,
      status: 'FAILED',
      result: null,
    });
  });

  it.each([null, { name: PRE_USD_PRICE_JOB }])(
    'does not expose missing or scheduled jobs',
    async (job) => {
      mocks.queue.getJob.mockResolvedValue(job);
      await expect(fixture().service.refreshStatus(jobId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('closes its lazy queue and connection on shutdown', async () => {
    const { service } = fixture();
    await service.refresh();
    await service.onModuleDestroy();
    expect(mocks.redis.disconnect).toHaveBeenCalledOnce();
    expect(mocks.queue.close).toHaveBeenCalledOnce();
  });

  it('shows contract pricing separately from the provider and exposes only safe publication fields', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-10-09T10:20:00.000Z');
    vi.setSystemTime(now);
    mocks.config.adsContract.address = '0x1111111111111111111111111111111111111111';
    vi.mocked(readLatestPreUsdPrice).mockResolvedValue(quote);
    mocks.indexedPrice.mockResolvedValue({
      preUsdPriceE18Raw: '1000000000000000',
      preUsdPriceQuotedAt: BigInt(Date.parse(quote.quotedAt) / 1000),
      priceUpdaterAddress: '0x2222222222222222222222222222222222222222',
      configBlockNumber: 100n,
      lastBlockNumber: 100n,
      updatedAt: now,
    });
    mocks.publication.mockResolvedValue({
      status: 'SUBMITTED',
      txHash: '0xtransaction',
      errorCode: 'WAITING_CONFIRMATION',
      quotedAt: BigInt(Date.parse(quote.quotedAt) / 1000),
      signedTransaction: 'private-fixture-bytes',
    });
    const view = await fixture().service.latest();
    expect(view.quote?.priceUsd).toBe(quote.priceUsd);
    expect(view.contract).toMatchObject({
      priceUsd: '0.001',
      status: 'FRESH',
      publication: { status: 'SUBMITTED', txHash: '0xtransaction' },
    });
    expect(JSON.stringify(view)).not.toContain('private-fixture-bytes');
    vi.setSystemTime(new Date('2026-10-09T11:20:00.000Z'));
    mocks.indexedPrice.mockResolvedValue({
      ...(await mocks.indexedPrice()),
      updatedAt: new Date(),
    });
    expect((await fixture().service.latest()).contract?.status).toBe('STALE');
  });

  it('never presents a stale index checkpoint as current contract pricing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T10:20:00.000Z'));
    mocks.config.adsContract.address = '0x1111111111111111111111111111111111111111';
    vi.mocked(readLatestPreUsdPrice).mockResolvedValue(quote);
    mocks.indexedPrice.mockResolvedValue({
      preUsdPriceE18Raw: '1000000000000000',
      preUsdPriceQuotedAt: 1_791_540_000n,
      configBlockNumber: 100n,
      lastBlockNumber: 100n,
      updatedAt: new Date('2026-10-09T10:18:00.000Z'),
    });
    expect((await fixture().service.latest()).contract?.status).toBe('SYNCING');
  });

  it('reads the selected deployment AUTO interval once and exposes its wallet refresh cadence', async () => {
    mocks.config.adsContract.address = '0x1111111111111111111111111111111111111111';
    mocks.chargeSettings.mockResolvedValue({ automaticEnabled: true, intervalMinutes: 30 });
    const view = await fixture().service.latest();
    expect(view.walletRefreshIntervalMs).toBe(1_800_000);
    expect(mocks.chargeSettings).toHaveBeenCalledOnce();
    expect(mocks.chargeSettings).toHaveBeenCalledWith({
      where: {
        chainId_contractAddress: {
          chainId: 84532,
          contractAddress: mocks.config.adsContract.address,
        },
      },
      select: { automaticEnabled: true, intervalMinutes: true },
    });
  });

  it.each([
    null,
    { automaticEnabled: false, intervalMinutes: 30 },
    { automaticEnabled: true, intervalMinutes: 0 },
  ])('uses ten minute wallet refresh without valid enabled AUTO settings: %j', async (settings) => {
    mocks.config.adsContract.address = '0x1111111111111111111111111111111111111111';
    mocks.chargeSettings.mockResolvedValue(settings);
    expect((await fixture().service.latest()).walletRefreshIntervalMs).toBe(600_000);
  });

  it('always exposes the fallback cadence without querying settings when the contract is absent', async () => {
    expect((await fixture().service.latest()).walletRefreshIntervalMs).toBe(600_000);
    expect(mocks.chargeSettings).not.toHaveBeenCalled();
  });

  describe('price updater ETH balance', () => {
    const updater = '0x2222222222222222222222222222222222222222';

    function configured(updaterAddress: string | null = updater) {
      mocks.config.adsContract.address = '0x1111111111111111111111111111111111111111';
      vi.mocked(readLatestPreUsdPrice).mockResolvedValue(quote);
      mocks.indexedPrice.mockResolvedValue({
        preUsdPriceE18Raw: '1000000000000000',
        preUsdPriceQuotedAt: BigInt(Date.parse(quote.quotedAt) / 1000),
        priceUpdaterAddress: updaterAddress,
        configBlockNumber: 100n,
        lastBlockNumber: 100n,
        updatedAt: new Date(),
      });
      return fixture().service;
    }

    it('returns the exact raw ETH balance for the authoritative indexed updater', async () => {
      const service = configured();
      mocks.rpc.getBalance.mockResolvedValue(123456789012345678901n);
      expect((await service.latest()).contract).toMatchObject({
        updaterAddress: updater,
        updaterGasBalanceRaw: '123456789012345678901',
      });
      expect(mocks.rpc.getBalance).toHaveBeenCalledWith({ address: updater, blockTag: 'latest' });
      expect(mocks.transport).toHaveBeenCalledWith(mocks.config.BASE_RPC_URL, {
        timeout: 2_000,
        retryCount: 0,
      });
    });

    it('keeps a successful zero balance distinct from an unavailable reading', async () => {
      expect((await configured().latest()).contract?.updaterGasBalanceRaw).toBe('0');
    });

    it.each([8453, 84532])(
      'accepts balances only from the configured chain %s',
      async (chainId) => {
        const service = configured();
        mocks.config.deployment.chainId = chainId;
        mocks.config.chain.id = chainId;
        mocks.rpc.getChainId.mockResolvedValue(chainId);
        mocks.rpc.getBalance.mockResolvedValue(42n);
        expect((await service.latest()).contract?.updaterGasBalanceRaw).toBe('42');
        expect(mocks.client).toHaveBeenCalledWith({
          chain: mocks.config.chain,
          transport: 'fixture-transport',
        });
      },
    );

    it('rejects a response from another chain before reading a balance', async () => {
      const service = configured();
      mocks.rpc.getChainId.mockResolvedValue(8453);
      expect((await service.latest()).contract?.updaterGasBalanceRaw).toBeNull();
      expect(mocks.rpc.getBalance).not.toHaveBeenCalled();
    });

    it.each(['getChainId', 'getBalance'] as const)(
      'keeps quote and publication available when %s fails without exposing provider details',
      async (method) => {
        const service = configured();
        mocks.publication.mockResolvedValue({
          status: 'CONFIRMED',
          txHash: '0xtransaction',
          errorCode: null,
          quotedAt: BigInt(Date.parse(quote.quotedAt) / 1000),
        });
        mocks.rpc[method].mockRejectedValue(
          new Error('https://private-rpc.example/?key=private-fixture'),
        );
        const view = await service.latest();
        expect(view.quote).toEqual(quote);
        expect(view.contract).toMatchObject({
          priceUsd: '0.001',
          updaterAddress: updater,
          updaterGasBalanceRaw: null,
          publication: { status: 'CONFIRMED', txHash: '0xtransaction', errorCode: null },
        });
        expect(JSON.stringify(view)).not.toContain('private-fixture');
      },
    );

    it.each([null, '0x0000000000000000000000000000000000000000', 'invalid-address'])(
      'skips an absent, revoked or invalid updater: %s',
      async (address) => {
        expect((await configured(address).latest()).contract?.updaterGasBalanceRaw).toBeNull();
        expect(mocks.client).not.toHaveBeenCalled();
        expect(mocks.rpc.getBalance).not.toHaveBeenCalled();
      },
    );

    it('includes the unavailable balance field when no contract is configured', async () => {
      vi.mocked(readLatestPreUsdPrice).mockResolvedValue(null);
      expect((await fixture().service.latest()).contract).toMatchObject({
        status: 'AWAITING_CONTRACT',
        updaterAddress: null,
        updaterGasBalanceRaw: null,
      });
      expect(mocks.client).not.toHaveBeenCalled();
    });
  });
});
