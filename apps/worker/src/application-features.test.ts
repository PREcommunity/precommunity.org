import { describe, expect, it, vi } from 'vitest';
import { runKeywordMarketJob } from './application-features';

describe('runKeywordMarketJob', () => {
  it('skips all side effects while the market is disabled', async () => {
    const database = {
      communitySettings: {
        findFirst: vi.fn().mockResolvedValue({ keywordMarketEnabled: false }),
      },
    };
    const run = vi.fn().mockResolvedValue({ processed: 1 });

    await expect(runKeywordMarketJob(database as never, run)).resolves.toEqual({
      status: 'DISABLED',
      feature: 'keyword-market',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the scheduled operation while the market is enabled', async () => {
    const database = {
      communitySettings: {
        findFirst: vi.fn().mockResolvedValue({ keywordMarketEnabled: true }),
      },
    };
    const run = vi.fn().mockResolvedValue({ processed: 1 });

    await expect(runKeywordMarketJob(database as never, run)).resolves.toEqual({ processed: 1 });
    expect(run).toHaveBeenCalledOnce();
  });
});
