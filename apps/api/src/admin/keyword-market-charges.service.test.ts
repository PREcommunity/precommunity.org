import 'reflect-metadata';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { readLatestPreUsdPrice } from '@precommunity/database';
import { AD_CHARGE_MANUAL_JOB, adChargeQueueName } from '@precommunity/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../common/prisma.service';
import type { AuthenticatedPrincipal } from '../common/request-context';
import { KeywordMarketChargesService } from './keyword-market-charges.service';

const mocks = vi.hoisted(() => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    chain: { id: 84532 },
    adsContract: { address: '0x1111111111111111111111111111111111111111' as string | null },
  },
  queue: { add: vi.fn(), on: vi.fn(), close: vi.fn(), waitUntilReady: vi.fn() },
  redis: { on: vi.fn(), disconnect: vi.fn() },
  queueConstructor: vi.fn(),
  redisConstructor: vi.fn(),
}));
vi.mock('../config', () => ({ config: mocks.config }));
vi.mock('../common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('@precommunity/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@precommunity/database')>()),
  readLatestPreUsdPrice: vi.fn(),
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

const contractAddress = '0x1111111111111111111111111111111111111111';
const scope = { chainId: 84532, contractAddress };
const runId = '564d4403-9a2d-480e-a3d8-fdabf2f0e5a7';
const now = new Date('2026-10-11T10:00:00.000Z');
const actor = { address: '0x2222222222222222222222222222222222222222' } as AuthenticatedPrincipal;
const batch = {
  id: 'batch-1',
  runId,
  chargeId: `0x${'33'.repeat(32)}`,
  ...scope,
  keywordId: `0x${'44'.repeat(32)}`,
  keyword: 'search',
  stakerAddress: actor.address,
  positionVersion: 9007199254740995n,
  clickCount: 2,
  duePreRaw: '3000000000000000000',
  requestedPreRaw: '2000000000000000000',
  chargedPreRaw: '2000000000000000000',
  shortfallPreRaw: '1000000000000000000',
  status: 'PARTIAL',
  txHash: `0x${'55'.repeat(32)}`,
  errorCode: 'INSUFFICIENT_STAKE',
  createdAt: now,
  updatedAt: now,
  signedTransaction: 'PRIVATE_SIGNED_TRANSACTION',
  nonce: 42n,
};
const run = {
  id: runId,
  trigger: 'MANUAL',
  status: 'PARTIAL',
  errorCode: 'INSUFFICIENT_STAKE',
  createdAt: now,
  startedAt: now,
  finishedAt: now,
  batches: [batch],
};

function fixture() {
  const db = {
    adChargeSettings: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    adChargeBatch: { findFirst: vi.fn(), findMany: vi.fn() },
    adChargeRun: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((callback) => callback(db));
  const settings = {
    ...scope,
    automaticEnabled: false,
    intervalMinutes: 10,
    clickThreshold: 50,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
    workerHeartbeatAt: now,
    readiness: 'READY',
    errorCode: null,
    signerAddress: actor.address,
    operatorAddress: actor.address,
    gasBalanceRaw: '100000000000000000',
  };
  db.adChargeSettings.findUnique.mockResolvedValue(settings);
  db.adChargeSettings.update.mockResolvedValue(settings);
  db.adChargeBatch.findMany.mockResolvedValue([]);
  db.adChargeRun.findFirst.mockResolvedValue(null);
  db.adChargeRun.create.mockResolvedValue({ id: runId });
  db.$queryRaw.mockResolvedValue([
    {
      clicks: 3n,
      preRaw: '9007199254740995000000000000000',
      usdRaw: '1234567',
      awaitingPriceClicks: 1n,
      captureErrors: 2n,
    },
  ]);
  return { db, settings, service: new KeywordMarketChargesService(db as unknown as PrismaService) };
}

describe('keyword market charge administration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.config.adsContract.address = contractAddress;
    mocks.queue.waitUntilReady.mockResolvedValue(undefined);
    mocks.queue.add.mockResolvedValue({ id: runId });
    vi.mocked(readLatestPreUsdPrice).mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it('reads scoped history and exact monetary totals without a queue or signed payloads', async () => {
    const { db, service } = fixture();
    db.adChargeBatch.findMany.mockResolvedValue([batch]);
    db.adChargeRun.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(run);
    const view = await service.latest();
    expect(view.pending).toEqual({
      clicks: 3,
      preRaw: '9007199254740995000000000000000',
      usdRaw: '1234567',
      awaitingPriceClicks: 1,
      captureErrors: 2,
    });
    expect(view.quoteStatus).toBe('MISSING');
    expect(view.readiness.status).toBe('READY');
    expect(view.history[0]?.positionVersion).toBe('9007199254740995');
    expect(JSON.stringify(view)).not.toContain('PRIVATE_SIGNED_TRANSACTION');
    expect(view.history[0]).not.toHaveProperty('nonce');
    expect(db.adChargeBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: scope, take: 21 }),
    );
    expect(mocks.queueConstructor).not.toHaveBeenCalled();
  });

  it('reports an unavailable worker when its heartbeat is stale', async () => {
    const { db, settings, service } = fixture();
    db.adChargeSettings.findUnique.mockResolvedValue({
      ...settings,
      workerHeartbeatAt: new Date(now.getTime() - 60_001),
    });
    const view = await service.latest();
    expect(view.readiness.status).toBe('WORKER_UNAVAILABLE');
    expect(view.readiness.errorCode).toBe('WORKER_UNAVAILABLE');
  });

  it('shows defaults when no contract is configured without reading an unrelated ledger', async () => {
    mocks.config.adsContract.address = null;
    const { db, service } = fixture();
    const view = await service.latest();
    expect(view.settings).toMatchObject({
      automaticEnabled: false,
      intervalMinutes: 10,
      clickThreshold: 50,
    });
    expect(view.readiness.errorCode).toBe('AWAITING_CONTRACT');
    expect(db.adChargeBatch.findMany).not.toHaveBeenCalled();
    await expect(service.run(actor)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('limits history to 20 rows and rejects a cursor from another deployment', async () => {
    const { db, service } = fixture();
    db.adChargeBatch.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({ ...batch, id: `batch-${index}` })),
    );
    const view = await service.latest();
    expect(view.history).toHaveLength(20);
    expect(view.nextCursor).toBe('batch-19');
    db.adChargeBatch.findFirst.mockResolvedValue(null);
    await expect(service.latest('foreign-cursor')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.adChargeBatch.findFirst).toHaveBeenCalledWith({
      where: { ...scope, id: 'foreign-cursor' },
      select: { id: true },
    });
  });

  it('audits settings changes while preserving deployment and worker fields', async () => {
    const { db, service } = fixture();
    const input = { automaticEnabled: true, intervalMinutes: 5, clickThreshold: 25 };
    await service.updateSettings(input, actor);
    expect(db.adChargeSettings.update).toHaveBeenCalledWith({
      where: { chainId_contractAddress: scope },
      data: { ...input, updatedBy: actor.address },
    });
    expect(db.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorAddress: actor.address,
          action: 'UPDATE_AD_CHARGE_SETTINGS',
        }),
      }),
    );
    expect(mocks.queue.add).not.toHaveBeenCalled();
  });

  it('persists a manual run before enqueueing and reuses an outstanding run', async () => {
    const { db, service } = fixture();
    await expect(service.run(actor)).resolves.toEqual({ jobId: runId });
    expect(db.adChargeRun.create).toHaveBeenCalledWith({
      data: { ...scope, trigger: 'MANUAL', actorAddress: actor.address },
      select: { id: true },
    });
    expect(db.adChargeRun.create.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.queue.add.mock.invocationCallOrder[0]!,
    );
    expect(mocks.queueConstructor).toHaveBeenCalledWith(
      adChargeQueueName(scope.chainId, scope.contractAddress),
      { connection: mocks.redis },
    );
    expect(mocks.queue.add).toHaveBeenCalledWith(
      AD_CHARGE_MANUAL_JOB,
      { runId },
      { jobId: runId, attempts: 1, removeOnComplete: 20, removeOnFail: 100 },
    );
    db.adChargeRun.findFirst.mockResolvedValue({ id: runId });
    await expect(service.run(actor)).resolves.toEqual({ jobId: runId });
    expect(db.adChargeRun.create).toHaveBeenCalledOnce();
  });

  it('records a safe queue error and retains the run identifier after uncertain enqueue', async () => {
    const { db, service } = fixture();
    mocks.queue.add.mockRejectedValue(new Error('redis://private-user:password@example.test'));
    await expect(service.run(actor)).rejects.toThrow('The charge queue is unavailable');
    expect(db.adChargeRun.updateMany).toHaveBeenCalledWith({
      where: { id: runId, status: 'QUEUED' },
      data: { errorCode: 'QUEUE_UNAVAILABLE' },
    });
  });

  it('bounds disconnected queue waits without submitting work', async () => {
    const { db, service } = fixture();
    mocks.queue.waitUntilReady.mockImplementationOnce(() => new Promise(() => undefined));
    const request = service.run(actor);
    const check = expect(request).rejects.toThrow('The charge queue is unavailable');
    await vi.advanceTimersByTimeAsync(5_000);
    await check;
    expect(mocks.queue.add).not.toHaveBeenCalled();
    expect(db.adChargeRun.create).toHaveBeenCalledOnce();
  });

  it('reads persisted run status without Redis and restricts it to the active deployment', async () => {
    const { db, service } = fixture();
    db.adChargeRun.findFirst.mockResolvedValue(run);
    const status = await service.runStatus(runId);
    expect(status).toMatchObject({ jobId: runId, status: 'PARTIAL' });
    expect(JSON.stringify(status)).not.toContain('PRIVATE_SIGNED_TRANSACTION');
    expect(mocks.queueConstructor).not.toHaveBeenCalled();
    expect(db.adChargeRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ...scope, id: runId } }),
    );
    db.adChargeRun.findFirst.mockResolvedValue(null);
    await expect(service.runStatus(runId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('links to the accepted charge transaction when a later retry was a duplicate', async () => {
    const { db, service } = fixture();
    const settledTxHash = `0x${'66'.repeat(32)}`;
    db.adChargeRun.findFirst.mockResolvedValue({
      ...run,
      batches: [{ ...batch, settledTxHash }],
    });
    const status = await service.runStatus(runId);
    expect(status.batches[0]?.txHash).toBe(settledTxHash);
    expect(status.batches[0]).not.toHaveProperty('settledTxHash');
    expect(JSON.stringify(status)).not.toContain('PRIVATE_SIGNED_TRANSACTION');
  });
});
