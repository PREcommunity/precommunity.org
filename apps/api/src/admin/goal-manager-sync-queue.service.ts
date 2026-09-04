import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

const queueName = 'precommunity-safe-proposals';
const jobName = 'sync-safe-goal-managers';

@Injectable()
export class GoalManagerSyncQueue {
  async refresh() {
    const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    queue.on('error', () => undefined);
    events.on('error', () => undefined);

    try {
      const job = await queue.add(
        jobName,
        {},
        {
          deduplication: { id: jobName },
          removeOnComplete: 20,
          removeOnFail: 100,
        },
      );
      return await job.waitUntilFinished(events, 30_000);
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Goal manager refresh could not be completed',
      );
    } finally {
      await Promise.allSettled([events.close(), queue.close()]);
      connection.disconnect();
    }
  }
}
