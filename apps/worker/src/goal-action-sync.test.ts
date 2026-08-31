import { describe, expect, it, vi } from 'vitest';

const safeApiKit = vi.hoisted(() => vi.fn());

vi.mock('@safe-global/api-kit', () => ({ default: safeApiKit }));
vi.mock('./config', () => ({
  config: {
    SAFE_ADDRESS: '0x1111111111111111111111111111111111111111',
    SAFE_TRANSACTION_SERVICE_API_KEY: 'test-key',
    SAFE_TRANSACTION_SERVICE_URL: undefined,
    deployment: { chainId: 8453 },
  },
}));

import { syncSafeGoalActionProposals } from './goal-action-sync';

describe('Safe goal action synchronization', () => {
  it('skips Safe API when no proposal is pending', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const database = { safeGoalActionProposal: { findMany } };

    await expect(syncSafeGoalActionProposals(database as never)).resolves.toEqual({
      status: 'SYNCED',
      checked: 0,
      updated: 0,
    });
    expect(findMany).toHaveBeenCalledOnce();
    expect(safeApiKit).not.toHaveBeenCalled();
  });
});
