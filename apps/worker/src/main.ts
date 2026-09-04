import './load-env';
import { prisma } from '@precommunity/database';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { scheduleJobs } from './schedule';
import { config } from './config';
import { indexEscrow, reconcileEscrow, retryUnavailableMetadata } from './indexer';
import { syncSafePayoutProposals } from './safe-proposals';
import { syncSafeGoalManagerPolicy, syncSafeGoalManagerProposals } from './goal-manager-sync';
import { syncSafeGoalActionProposals } from './goal-action-sync';
import { indexAds } from './ads-chain-source';
import { flushAdResolutionMetrics, retainAdsData } from './ads-maintenance';
import { runKeywordMarketJob } from './application-features';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queueName = 'precommunity-chain-indexer';
const safeQueueName = 'precommunity-safe-proposals';
const queue = new Queue(queueName, { connection });
const safeQueue = new Queue(safeQueueName, { connection });

const worker = new Worker(
  queueName,
  async (job) => {
    if (job.name === 'index-escrow') return indexEscrow(prisma);
    if (job.name === 'refresh-metadata') return retryUnavailableMetadata(prisma);
    if (job.name === 'index-ads') return runKeywordMarketJob(prisma, () => indexAds(prisma));
    if (job.name === 'flush-ad-metrics') {
      return runKeywordMarketJob(prisma, () => flushAdResolutionMetrics(prisma, connection));
    }
    if (job.name === 'retain-ads-data') {
      return runKeywordMarketJob(prisma, () => retainAdsData(prisma));
    }
    if (job.name === 'reconcile-escrow') {
      const result = await reconcileEscrow(prisma);
      if (result.status === 'RECONCILED' && (!result.PRE.matches || !result.USDC.matches))
        throw new Error(`Escrow reconciliation mismatch: ${JSON.stringify(result)}`);
      return result;
    }
    throw new Error(`Unknown job: ${job.name}`);
  },
  { connection, concurrency: 1 },
);

const safeWorker = new Worker(
  safeQueueName,
  async (job) => {
    if (job.name === 'sync-safe-payouts') return syncSafePayoutProposals(prisma);
    if (job.name === 'sync-safe-goal-managers') {
      const policy = await syncSafeGoalManagerPolicy(prisma);
      const proposals = await syncSafeGoalManagerProposals(prisma);
      return { policy, proposals };
    }
    if (job.name === 'sync-safe-goal-actions') return syncSafeGoalActionProposals(prisma);
    throw new Error(`Unknown Safe job: ${job.name}`);
  },
  { connection, concurrency: 1 },
);

function logFailedJob(job: Job | undefined, error: Error) {
  console.error(
    JSON.stringify({
      level: 'error',
      service: 'precommunity-worker',
      job: job?.name,
      jobId: job?.id,
      message: error.message,
    }),
  );
}

worker.on('failed', logFailedJob);
safeWorker.on('failed', logFailedJob);

async function shutdown() {
  await worker.close();
  await safeWorker.close();
  await queue.close();
  await safeQueue.close();
  await connection.quit();
  await prisma.$disconnect();
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
void scheduleJobs(queue, safeQueue);
