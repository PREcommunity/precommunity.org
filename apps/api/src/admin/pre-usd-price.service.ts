import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readLatestPreUsdPrice } from '@precommunity/database';
import {
  PRE_USD_PRICE_MANUAL_JOB,
  PRE_USD_PRICE_QUEUE,
  preUsdPriceSnapshot,
  type PreUsdPriceAdminView,
  type PreUsdPriceRefreshResult,
  type PreUsdPriceRefreshStatus,
} from '@precommunity/shared';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { formatUnits } from 'viem';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';

function safeResult(value: unknown): PreUsdPriceRefreshResult | null {
  if (!value || typeof value !== 'object' || !('outcome' in value)) return null;
  if (value.outcome === 'UPDATED' || value.outcome === 'UNCHANGED') {
    return { outcome: value.outcome };
  }
  if (
    value.outcome === 'COOLDOWN' &&
    'retryAt' in value &&
    typeof value.retryAt === 'string' &&
    Number.isFinite(Date.parse(value.retryAt))
  ) {
    return { outcome: 'COOLDOWN', retryAt: new Date(value.retryAt).toISOString() };
  }
  return null;
}

@Injectable()
export class PreUsdPriceService implements OnModuleDestroy {
  private connection?: IORedis;
  private queue?: Queue;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async latest(): Promise<PreUsdPriceAdminView> {
    const quote = await readLatestPreUsdPrice(this.prisma);
    const address = config.adsContract.address;
    const identity = { chainId: config.deployment.chainId, contractAddress: address ?? '' };
    const [state, publication] = address
      ? await Promise.all([
          this.prisma.adIndexerState.findUnique({
            where: { key: `${identity.chainId}:${address}` },
          }),
          this.prisma.adPricePublication.findFirst({
            where: identity,
            orderBy: { createdAt: 'desc' },
          }),
        ])
      : [null, null];
    const priceUsd =
      state?.preUsdPriceE18Raw && BigInt(state.preUsdPriceE18Raw) > 0n
        ? formatUnits(BigInt(state.preUsdPriceE18Raw), 18)
        : null;
    const quotedAt =
      state?.preUsdPriceQuotedAt && state.preUsdPriceQuotedAt > 0n
        ? new Date(Number(state.preUsdPriceQuotedAt) * 1_000).toISOString()
        : null;
    const status = !address
      ? 'AWAITING_CONTRACT'
      : !state ||
          state.configBlockNumber !== state.lastBlockNumber ||
          Date.now() - state.updatedAt.getTime() < 0 ||
          Date.now() - state.updatedAt.getTime() > 60_000
        ? 'SYNCING'
        : priceUsd && quotedAt
          ? preUsdPriceSnapshot({
              id: '',
              source: 'COINGECKO',
              assetId: 'presearch',
              priceUsd,
              quotedAt,
              fetchedAt: quotedAt,
            }).status
          : 'MISSING';
    return {
      ...preUsdPriceSnapshot(quote),
      collectorEnabled: Boolean(config.COINGECKO_API_KEY),
      contract: {
        chainId: identity.chainId,
        address,
        priceUsd,
        quotedAt,
        status,
        updaterAddress: state?.priceUpdaterAddress ?? null,
        publication: publication
          ? {
              status: publication.status,
              txHash: publication.txHash,
              errorCode: publication.errorCode,
              quotedAt: new Date(Number(publication.quotedAt) * 1_000).toISOString(),
            }
          : null,
      },
    };
  }

  async refresh(): Promise<{ jobId: string }> {
    if (!config.COINGECKO_API_KEY) {
      throw new ServiceUnavailableException('PRE/USD price updates are not configured');
    }
    return this.queueRequest(async (queue) => {
      const job = await queue.add(
        PRE_USD_PRICE_MANUAL_JOB,
        {},
        {
          jobId: randomUUID(),
          deduplication: { id: PRE_USD_PRICE_MANUAL_JOB },
          attempts: 1,
          removeOnComplete: 20,
          removeOnFail: 100,
        },
      );
      if (!job.id) throw new Error('Price refresh job has no identifier');
      return { jobId: job.id };
    });
  }

  async refreshStatus(jobId: string): Promise<PreUsdPriceRefreshStatus> {
    return this.queueRequest(async (queue) => {
      const job = await queue.getJob(jobId);
      if (!job || job.name !== PRE_USD_PRICE_MANUAL_JOB) {
        throw new NotFoundException('Price refresh job was not found');
      }
      const state = await job.getState();
      if (state === 'completed') {
        const result = safeResult(job.returnvalue);
        return { jobId, status: result ? 'COMPLETED' : 'FAILED', result };
      }
      return {
        jobId,
        status: state === 'active' ? 'RUNNING' : state === 'failed' ? 'FAILED' : 'QUEUED',
        result: null,
      };
    });
  }

  async onModuleDestroy() {
    this.connection?.disconnect();
    if (this.queue) await Promise.allSettled([this.queue.close()]);
  }

  private getQueue() {
    if (!this.queue) {
      this.connection = new IORedis(config.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 5_000,
        connectTimeout: 5_000,
        retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
      });
      this.connection.on('error', () => undefined);
      this.queue = new Queue(PRE_USD_PRICE_QUEUE, { connection: this.connection });
      this.queue.on('error', () => undefined);
    }
    return this.queue;
  }

  private async queueRequest<T>(operation: (queue: Queue) => Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const queue = this.getQueue();
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Price refresh queue timed out')), 5_000);
      });
      await Promise.race([queue.waitUntilReady(), deadline]);
      return await Promise.race([operation(queue), deadline]);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException('PRE/USD price update queue is unavailable');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
