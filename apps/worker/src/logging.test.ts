import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachWorkerLogs, logWorkerError, logWorkerEvent } from './logging';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture() {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const worker = Object.assign(new EventEmitter(), { name: 'precommunity-chain-indexer' });
  attachWorkerLogs(worker as never);
  return {
    worker,
    info: () => info.mock.calls.map(([line]) => JSON.parse(String(line))),
    errors: () => error.mock.calls.map(([line]) => JSON.parse(String(line))),
  };
}

describe('worker logs', () => {
  it('timestamps events and serializes block numbers safely', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z'));
    const f = fixture();
    logWorkerEvent('worker_starting', { chainId: 84532, indexedThroughBlock: 123n });
    expect(f.info()).toEqual([
      {
        timestamp: '2026-10-12T10:00:00.000Z',
        level: 'info',
        service: 'precommunity-worker',
        event: 'worker_starting',
        chainId: 84532,
        indexedThroughBlock: '123',
      },
    ]);
  });

  it('shows activity and blocked outcomes without logging job data or arbitrary results', () => {
    const f = fixture();
    const job = {
      name: 'index-ads',
      id: 'job-1',
      processedOn: 1000,
      finishedOn: 3500,
      data: { password: 'private-job-data' },
    };
    f.worker.emit('ready');
    f.worker.emit('active', job);
    f.worker.emit('completed', job, {
      outcome: 'BLOCKED',
      errorCode: 'RPC_UNAVAILABLE',
      status: 'DISABLED',
      processed: 0,
      indexedThroughBlock: 123n,
      password: 'private-result',
      signedTransaction: `0x${'a'.repeat(200)}`,
      provider: { apiKey: 'private-provider' },
    });
    expect(f.info().map((entry) => entry.event)).toEqual([
      'worker_ready',
      'job_started',
      'job_completed',
    ]);
    expect(f.info()[2]).toMatchObject({
      queue: 'precommunity-chain-indexer',
      job: 'index-ads',
      jobId: 'job-1',
      durationMs: 2500,
      result: {
        outcome: 'BLOCKED',
        errorCode: 'RPC_UNAVAILABLE',
        status: 'DISABLED',
        processed: 0,
        indexedThroughBlock: '123',
      },
    });
    expect(JSON.stringify(f.info())).not.toMatch(/private-|0xaaaa/);
    expect(f.info()[2].result).not.toHaveProperty('provider');
  });

  it('redacts connection credentials, tokens and signed data and drops multiline details', () => {
    const f = fixture();
    const failure = new Error(
      `RPC https://user:secret@example.test/key?token=private-url password=private-password API_KEY=private-api access_token=private-access Authorization: Bearer private-bearer COINGECKO_API_KEY="private-env" {"apiKey":"private-json"} data=0x${'b'.repeat(200)}\nRaw request contains private-second-line`,
    );
    failure.name = 'RpcRequestError';
    logWorkerError('job_failed', failure, { job: 'index-ads' });
    expect(f.errors()[0]).toMatchObject({
      level: 'error',
      event: 'job_failed',
      errorType: 'RpcRequestError',
      job: 'index-ads',
    });
    expect(f.errors()[0].message).toContain('[redacted-url]');
    expect(f.errors()[0].message).toContain('[redacted-hex]');
    expect(JSON.stringify(f.errors())).not.toMatch(/private-|user:secret|0xbbbb/);
  });

  it('logs worker errors, missing failed jobs and stalled job IDs', () => {
    const f = fixture();
    f.worker.emit('error', new Error('Connection refused'));
    f.worker.emit('failed', undefined, new Error('Job is missing'));
    f.worker.emit('stalled', 'job-2');
    expect(f.errors().map((entry) => entry.event)).toEqual([
      'worker_error',
      'job_failed',
      'job_stalled',
    ]);
    expect(f.errors()[1]).not.toHaveProperty('jobId');
    expect(f.errors()[2]).toMatchObject({ queue: 'precommunity-chain-indexer', jobId: 'job-2' });
  });
});
