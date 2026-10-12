import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, readLatestPreUsdPrice, type AdChargeSettings } from '@precommunity/database';
import {
  AD_CHARGE_DEFAULTS,
  AD_CHARGE_MANUAL_JOB,
  adChargeQueueName,
  preUsdPriceSnapshot,
  type AdChargeAdminView,
  type AdChargeBatchView,
  type AdChargeRunView,
  type AdChargeSettingsInput,
  type AdChargeSettingsView,
} from '@precommunity/shared';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../common/prisma.service';
import type { AuthenticatedPrincipal } from '../common/request-context';
import { config } from '../config';

// Public charge records deliberately omit signed transactions and nonce details.
const batchSelect = {
  id: true,
  runId: true,
  chargeId: true,
  chainId: true,
  contractAddress: true,
  keywordId: true,
  keyword: true,
  stakerAddress: true,
  positionVersion: true,
  clickCount: true,
  duePreRaw: true,
  requestedPreRaw: true,
  chargedPreRaw: true,
  shortfallPreRaw: true,
  status: true,
  txHash: true,
  settledTxHash: true,
  errorCode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdChargeBatchSelect;
const runSelect = {
  id: true,
  trigger: true,
  status: true,
  errorCode: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  batches: { select: batchSelect, orderBy: { createdAt: 'desc' as const }, take: 20 },
} satisfies Prisma.AdChargeRunSelect;
type BatchRecord = Prisma.AdChargeBatchGetPayload<{ select: typeof batchSelect }>;
type RunRecord = Prisma.AdChargeRunGetPayload<{ select: typeof runSelect }>;

function batchView(batch: BatchRecord): AdChargeBatchView {
  return {
    id: batch.id,
    runId: batch.runId,
    chargeId: batch.chargeId,
    chainId: batch.chainId,
    contractAddress: batch.contractAddress,
    keywordId: batch.keywordId,
    keyword: batch.keyword,
    stakerAddress: batch.stakerAddress,
    positionVersion: batch.positionVersion.toString(),
    clickCount: batch.clickCount,
    duePreRaw: batch.duePreRaw,
    requestedPreRaw: batch.requestedPreRaw,
    chargedPreRaw: batch.chargedPreRaw,
    shortfallPreRaw: batch.shortfallPreRaw,
    status: batch.status as AdChargeBatchView['status'],
    txHash: batch.settledTxHash ?? batch.txHash,
    errorCode: batch.errorCode,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

function runView(run: RunRecord): AdChargeRunView {
  return {
    jobId: run.id,
    trigger: run.trigger as AdChargeRunView['trigger'],
    status: run.status as AdChargeRunView['status'],
    errorCode: run.errorCode,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    batches: run.batches.map(batchView),
  };
}

function settingsView(settings: AdChargeSettings | null): AdChargeSettingsView {
  return {
    automaticEnabled: settings?.automaticEnabled ?? AD_CHARGE_DEFAULTS.automaticEnabled,
    intervalMinutes: settings?.intervalMinutes ?? AD_CHARGE_DEFAULTS.intervalMinutes,
    clickThreshold: settings?.clickThreshold ?? AD_CHARGE_DEFAULTS.clickThreshold,
    updatedBy: settings?.updatedBy ?? null,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  };
}

@Injectable()
export class KeywordMarketChargesService implements OnModuleDestroy {
  private connection?: IORedis;
  private queue?: Queue;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async latest(cursor?: string): Promise<AdChargeAdminView> {
    const chainId = config.chain.id;
    const contractAddress = config.adsContract.address;
    const quoteStatus = preUsdPriceSnapshot(await readLatestPreUsdPrice(this.prisma)).status;
    const emptyPending = {
      clicks: 0,
      preRaw: '0',
      usdRaw: '0',
      awaitingPriceClicks: 0,
      captureErrors: 0,
    };
    if (!contractAddress) {
      return {
        chainId,
        contractAddress,
        quoteStatus,
        settings: settingsView(null),
        readiness: {
          status: 'BLOCKED',
          errorCode: 'AWAITING_CONTRACT',
          signerAddress: null,
          operatorAddress: null,
          gasBalanceRaw: null,
          workerHeartbeatAt: null,
        },
        pending: emptyPending,
        history: [],
        nextCursor: null,
        latestRun: null,
      };
    }
    const scope = { chainId, contractAddress };
    if (cursor) {
      const exists = await this.prisma.adChargeBatch.findFirst({
        where: { ...scope, id: cursor },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Charge history cursor was not found');
    }
    const [settings, history, activeRun, latestRun, pendingRows] = await Promise.all([
      this.prisma.adChargeSettings.findUnique({ where: { chainId_contractAddress: scope } }),
      this.prisma.adChargeBatch.findMany({
        where: scope,
        select: batchSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.adChargeRun.findFirst({
        where: { ...scope, status: { in: ['QUEUED', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
        select: runSelect,
      }),
      this.prisma.adChargeRun.findFirst({
        where: scope,
        orderBy: { createdAt: 'desc' },
        select: runSelect,
      }),
      this.prisma.$queryRaw<
        Array<{
          clicks: bigint;
          preRaw: string;
          usdRaw: string;
          awaitingPriceClicks: bigint;
          captureErrors: bigint;
        }>
      >`
        SELECT
          COUNT(*) FILTER (WHERE "status" IN ('PENDING', 'PRICE_PENDING', 'RESERVED')) AS "clicks",
          COALESCE(SUM("amountPreRaw"::numeric) FILTER
            (WHERE "status" IN ('PENDING', 'RESERVED')), 0)::text AS "preRaw",
          COALESCE(SUM("bidUsdRaw"::numeric) FILTER
            (WHERE "status" = 'PRICE_PENDING'), 0)::text AS "usdRaw",
          COUNT(*) FILTER (WHERE "status" = 'PRICE_PENDING') AS "awaitingPriceClicks",
          COUNT(*) FILTER (WHERE "status" = 'UNBILLED') AS "captureErrors"
        FROM "AdBillingClick" WHERE "chainId" = ${chainId} AND "contractAddress" = ${contractAddress}
          AND "status" IN ('PENDING', 'PRICE_PENDING', 'RESERVED', 'UNBILLED')
      `,
    ]);
    const heartbeat = settings?.workerHeartbeatAt;
    const heartbeatAge = heartbeat ? Date.now() - heartbeat.getTime() : Infinity;
    const freshWorker = heartbeatAge >= -60_000 && heartbeatAge <= 60_000;
    const knownReadiness = ['READY', 'BLOCKED', 'WAITING_CONFIRMATION'].includes(
      settings?.readiness ?? '',
    );
    const status: AdChargeAdminView['readiness']['status'] =
      freshWorker && knownReadiness
        ? (settings!.readiness as AdChargeAdminView['readiness']['status'])
        : 'WORKER_UNAVAILABLE';
    const pending = pendingRows[0];
    const selectedRun = activeRun ?? latestRun;
    return {
      chainId,
      contractAddress,
      quoteStatus,
      settings: settingsView(settings),
      readiness: {
        status,
        errorCode:
          status === 'WORKER_UNAVAILABLE' ? 'WORKER_UNAVAILABLE' : (settings?.errorCode ?? null),
        signerAddress: settings?.signerAddress ?? null,
        operatorAddress: settings?.operatorAddress ?? null,
        gasBalanceRaw: settings?.gasBalanceRaw ?? null,
        workerHeartbeatAt: heartbeat?.toISOString() ?? null,
      },
      pending: pending
        ? {
            clicks: Number(pending.clicks),
            preRaw: pending.preRaw,
            usdRaw: pending.usdRaw,
            awaitingPriceClicks: Number(pending.awaitingPriceClicks),
            captureErrors: Number(pending.captureErrors),
          }
        : emptyPending,
      history: history.slice(0, 20).map(batchView),
      nextCursor: history.length > 20 ? history[19]!.id : null,
      latestRun: selectedRun ? runView(selectedRun) : null,
    };
  }

  async updateSettings(input: AdChargeSettingsInput, actor: AuthenticatedPrincipal) {
    const scope = this.scope();
    const settings = await this.prisma.$transaction(async (tx) => {
      await tx.adChargeSettings.upsert({
        where: { chainId_contractAddress: scope },
        create: scope,
        update: {},
      });
      await tx.$queryRaw`SELECT "chainId" FROM "AdChargeSettings"
        WHERE "chainId" = ${scope.chainId} AND "contractAddress" = ${scope.contractAddress} FOR UPDATE`;
      const before = await tx.adChargeSettings.findUnique({
        where: { chainId_contractAddress: scope },
      });
      const next = await tx.adChargeSettings.update({
        where: { chainId_contractAddress: scope },
        data: { ...input, updatedBy: actor.address },
      });
      await tx.auditEvent.create({
        data: {
          actorAddress: actor.address,
          entityType: 'AdChargeSettings',
          entityId: `${scope.chainId}:${scope.contractAddress}`,
          action: 'UPDATE_AD_CHARGE_SETTINGS',
          before: settingsView(before) as unknown as Prisma.InputJsonValue,
          after: settingsView(next) as unknown as Prisma.InputJsonValue,
        },
      });
      return next;
    });
    return settingsView(settings);
  }

  async run(actor: AuthenticatedPrincipal): Promise<{ jobId: string }> {
    const scope = this.scope();
    const run = await this.prisma.$transaction(async (tx) => {
      await tx.adChargeSettings.upsert({
        where: { chainId_contractAddress: scope },
        create: scope,
        update: {},
      });
      await tx.$queryRaw`SELECT "chainId" FROM "AdChargeSettings"
        WHERE "chainId" = ${scope.chainId} AND "contractAddress" = ${scope.contractAddress} FOR UPDATE`;
      return (
        (await tx.adChargeRun.findFirst({
          where: { ...scope, trigger: 'MANUAL', status: { in: ['QUEUED', 'RUNNING'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })) ??
        (await tx.adChargeRun.create({
          data: { ...scope, trigger: 'MANUAL', actorAddress: actor.address },
          select: { id: true },
        }))
      );
    });
    try {
      await this.queueRequest(async (queue) => {
        await queue.add(
          AD_CHARGE_MANUAL_JOB,
          { runId: run.id },
          {
            jobId: run.id,
            attempts: 1,
            removeOnComplete: 20,
            removeOnFail: 100,
          },
        );
      });
    } catch (error) {
      // Enqueue may have succeeded after the timeout; retain its ID for safe retry/recovery.
      await this.prisma.adChargeRun.updateMany({
        where: { id: run.id, status: 'QUEUED' },
        data: { errorCode: 'QUEUE_UNAVAILABLE' },
      });
      throw error;
    }
    return { jobId: run.id };
  }

  async runStatus(jobId: string): Promise<AdChargeRunView> {
    const run = await this.prisma.adChargeRun.findFirst({
      where: { ...this.scope(), id: jobId },
      select: runSelect,
    });
    if (!run) throw new NotFoundException('Charge run was not found');
    return runView(run);
  }

  async onModuleDestroy() {
    this.connection?.disconnect();
    if (this.queue) await Promise.allSettled([this.queue.close()]);
  }

  private scope() {
    if (!config.adsContract.address) {
      throw new ServiceUnavailableException('The Keyword Market contract is not configured');
    }
    return { chainId: config.chain.id, contractAddress: config.adsContract.address };
  }

  private getQueue() {
    if (!this.queue) {
      const scope = this.scope();
      this.connection = new IORedis(config.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 5_000,
        connectTimeout: 5_000,
        retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
      });
      this.connection.on('error', () => undefined);
      this.queue = new Queue(adChargeQueueName(scope.chainId, scope.contractAddress), {
        connection: this.connection,
      });
      this.queue.on('error', () => undefined);
    }
    return this.queue;
  }

  private async queueRequest<T>(operation: (queue: Queue) => Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const queue = this.getQueue();
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Charge queue timed out')), 5_000);
      });
      await Promise.race([queue.waitUntilReady(), deadline]);
      return await Promise.race([operation(queue), deadline]);
    } catch {
      throw new ServiceUnavailableException('The charge queue is unavailable');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
