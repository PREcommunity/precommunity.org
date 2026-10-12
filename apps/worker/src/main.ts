import './load-env';
import { prisma, readLatestPreUsdPrice } from '@precommunity/database';
import {
  PRE_USD_PRICE_QUEUE,
  PRE_USD_PRICE_JOB,
  PRE_USD_PRICE_MANUAL_JOB,
  PRE_USD_PRICE_PUBLICATION_JOB,
  AD_CHARGE_JOB,
  AD_CHARGE_MANUAL_JOB,
  adChargeQueueName,
  preUsdPricePublicationQueueName,
} from '@precommunity/shared';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  scheduleJobs,
  schedulePreUsdPrices,
  scheduleAdCharges,
  schedulePreUsdPricePublications,
} from './schedule';
import { config } from './config';
import { indexEscrow, reconcileEscrow, retryUnavailableMetadata } from './indexer';
import { syncSafePayoutProposals } from './safe-proposals';
import { syncSafeGoalManagerPolicy, syncSafeGoalManagerProposals } from './goal-manager-sync';
import { syncSafeGoalActionProposals } from './goal-action-sync';
import { indexAds } from './ads-chain-source';
import { flushAdResolutionMetrics, retainAdsData } from './ads-maintenance';
import { runKeywordMarketJob, runKeywordMarketIndexing } from './application-features';
import { collectPreUsdPrice } from './pre-usd-price';
import { processPreUsdPricePublication } from './pre-usd-price-publication';
import { processAdChargeJob } from './keyword-market-charges';
import { attachWorkerLogs, logWorkerError, logWorkerEvent } from './logging';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queueName = 'precommunity-chain-indexer';
const safeQueueName = 'precommunity-safe-proposals';
const queue = new Queue(queueName, { connection });
const safeQueue = new Queue(safeQueueName, { connection });
const priceQueue = new Queue(PRE_USD_PRICE_QUEUE, { connection });
const chargeQueueName = config.adsContract.address
  ? adChargeQueueName(config.deployment.chainId, config.adsContract.address)
  : null;
const chargeQueue = chargeQueueName ? new Queue(chargeQueueName, { connection }) : null;
const publicationQueueName = config.adsContract.address
  ? preUsdPricePublicationQueueName(config.deployment.chainId, config.adsContract.address)
  : null;
const publicationQueue = publicationQueueName
  ? new Queue(publicationQueueName, { connection })
  : null;
const publicationWorker = publicationQueueName
  ? new Worker(
      publicationQueueName,
      async (job) => {
        if (job.name !== PRE_USD_PRICE_PUBLICATION_JOB)
          throw new Error('Unknown PRE/USD publication job');
        try {
          const result = await processPreUsdPricePublication(prisma);
          logWorkerEvent(
            'price_publication_checked',
            { job: job.name, jobId: job.id, ...result },
            result.outcome === 'BLOCKED' ? 'error' : 'info',
          );
          return result;
        } catch {
          throw new Error('PRE/USD price publication failed');
        }
      },
      { connection, concurrency: 1 },
    )
  : null;
const chargeWorker = chargeQueueName
  ? new Worker<{ runId?: string }>(
      chargeQueueName,
      async (job) => {
        if (job.name !== AD_CHARGE_JOB && job.name !== AD_CHARGE_MANUAL_JOB) {
          throw new Error('Unknown charge job');
        }
        try {
          return await processAdChargeJob(prisma, job.data);
        } catch {
          // Raw wallet/provider errors can contain credentials and signed transactions.
          throw new Error('Keyword Market charge processing failed');
        }
      },
      { connection, concurrency: 1 },
    )
  : null;
const priceApiKey = config.COINGECKO_API_KEY;
const priceWorker = priceApiKey
  ? new Worker(
      PRE_USD_PRICE_QUEUE,
      async (job) => {
        if (job.name !== PRE_USD_PRICE_JOB && job.name !== PRE_USD_PRICE_MANUAL_JOB) {
          throw new Error('Unknown PRE/USD price job');
        }
        const result = await collectPreUsdPrice(prisma, connection, priceApiKey);
        const quote = await readLatestPreUsdPrice(prisma);
        logWorkerEvent('price_checked', {
          job: job.name,
          jobId: job.id,
          outcome: result.outcome,
          quoteAgeSeconds: quote
            ? Math.floor((Date.now() - Date.parse(quote.quotedAt)) / 1000)
            : null,
        });
        return result;
      },
      { connection, concurrency: 1 },
    )
  : null;

const worker = new Worker(
  queueName,
  async (job) => {
    if (job.name === 'index-escrow') return indexEscrow(prisma);
    if (job.name === 'refresh-metadata') return retryUnavailableMetadata(prisma);
    if (job.name === 'index-ads')
      return runKeywordMarketIndexing(prisma, () => indexAds(prisma), {
        chainId: config.deployment.chainId,
        contractAddress: config.adsContract.address,
      });
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

for (const current of [worker, safeWorker, priceWorker, chargeWorker, publicationWorker]) {
  if (current) attachWorkerLogs(current);
}
for (const current of [queue, safeQueue, priceQueue, chargeQueue, publicationQueue]) {
  current?.on('error', (error) => logWorkerError('queue_error', error, { queue: current.name }));
}
connection.on('error', (error) => logWorkerError('redis_error', error));
logWorkerEvent('worker_started', {
  pid: process.pid,
  network: config.deployment.network,
  chainId: config.deployment.chainId,
  escrowAddress: config.deployment.escrowAddress,
  keywordMarketAddress: config.adsContract.address,
  priceCollectionEnabled: Boolean(priceWorker),
  chargeWorkerEnabled: Boolean(chargeWorker),
  pricePublicationEnabled: Boolean(publicationWorker),
});

async function shutdown() {
  logWorkerEvent('worker_stopping');
  await worker.close();
  await safeWorker.close();
  await priceWorker?.close();
  await chargeWorker?.close();
  await publicationWorker?.close();
  await queue.close();
  await safeQueue.close();
  await priceQueue.close();
  await chargeQueue?.close();
  await publicationQueue?.close();
  await connection.quit();
  await prisma.$disconnect();
  logWorkerEvent('worker_stopped');
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
void scheduleJobs(queue, safeQueue)
  .then(() => logWorkerEvent('jobs_scheduled', { queue: queueName, safeQueue: safeQueueName }))
  .catch((error: unknown) => logWorkerError('scheduling_failed', error, { queue: queueName }));
if (chargeQueue)
  void scheduleAdCharges(chargeQueue).catch(() => {
    logWorkerEvent(
      'scheduling_failed',
      { job: AD_CHARGE_JOB, message: 'Charge scheduling failed' },
      'error',
    );
  });
if (publicationQueue)
  void schedulePreUsdPricePublications(publicationQueue).catch(() => {
    logWorkerEvent(
      'scheduling_failed',
      { job: PRE_USD_PRICE_PUBLICATION_JOB, message: 'Price publication scheduling failed' },
      'error',
    );
  });
void schedulePreUsdPrices(priceQueue, Boolean(priceApiKey)).catch((error: unknown) => {
  logWorkerError('scheduling_failed', error, { job: PRE_USD_PRICE_JOB });
});
