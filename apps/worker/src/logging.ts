import type { Job, Worker } from 'bullmq';

function redact(message: string) {
  return message
    .replace(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/0x[a-f\d]{64,}/gi, '[redacted-hex]')
    .replace(
      /\b((?:[\w-]*[-_])?(?:api[-_]?key|access[-_]?token|authorization|password|passwd|secret|private[-_]?key|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer\s+)?[^\s,;]+)/gi,
      '$1[redacted]',
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]');
}

export function logWorkerEvent(
  event: string,
  details: Record<string, unknown> = {},
  level: 'info' | 'error' = 'info',
) {
  console[level](
    JSON.stringify(
      {
        ...details,
        timestamp: new Date().toISOString(),
        level,
        service: 'precommunity-worker',
        event,
      },
      (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    ),
  );
}

export function logWorkerError(
  event: string,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  const message = error instanceof Error ? error.message : String(error);
  logWorkerEvent(
    event,
    {
      ...details,
      errorType: error instanceof Error ? redact(error.name) : typeof error,
      message: redact(message.split(/[\r\n]/, 1)[0] ?? ''),
    },
    'error',
  );
}

const resultFields = new Set([
  'status',
  'outcome',
  'errorCode',
  'feature',
  'chainId',
  'contractAddress',
  'deploymentBlock',
  'processed',
  'indexedThroughBlock',
  'head',
  'checked',
  'updated',
  'reconciled',
  'expired',
  'attempted',
  'recovered',
  'batches',
  'applied',
  'resolutions',
  'views',
  'clicks',
  'reports',
  'dailyMetrics',
  'metricFlushReceipts',
  'safeOwners',
  'preservedLegacyManagers',
]);

function summarizeResult(result: unknown) {
  if (!result || typeof result !== 'object') return {};
  return Object.fromEntries(
    Object.entries(result).flatMap(([key, value]) => {
      if (!resultFields.has(key)) return [];
      if (typeof value === 'string') return [[key, redact(value)]];
      if (typeof value === 'bigint') return [[key, value.toString()]];
      if (value === null || typeof value === 'number' || typeof value === 'boolean')
        return [[key, value]];
      return [];
    }),
  );
}

function jobDetails(job: Job | undefined) {
  return {
    job: job?.name,
    jobId: job?.id,
    durationMs:
      job?.processedOn === undefined
        ? undefined
        : Math.max(0, (job.finishedOn ?? Date.now()) - job.processedOn),
  };
}

export function attachWorkerLogs(worker: Worker) {
  const queue = { queue: worker.name };
  worker.on('ready', () => logWorkerEvent('worker_ready', queue));
  worker.on('active', (job) =>
    logWorkerEvent('job_started', { ...queue, job: job.name, jobId: job.id }),
  );
  worker.on('completed', (job, result: unknown) =>
    logWorkerEvent('job_completed', {
      ...queue,
      ...jobDetails(job),
      result: summarizeResult(result),
    }),
  );
  worker.on('failed', (job, error) =>
    logWorkerError('job_failed', error, { ...queue, ...jobDetails(job) }),
  );
  worker.on('error', (error) => logWorkerError('worker_error', error, queue));
  worker.on('stalled', (jobId) => logWorkerEvent('job_stalled', { ...queue, jobId }, 'error'));
}
