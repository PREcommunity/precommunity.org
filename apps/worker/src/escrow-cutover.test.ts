import {
  escrowCutoverDeploymentEnvKeys,
  escrowCutoverBlockers,
  FundingAsset,
  hasEscrowCutoverBlockers,
  resetForEscrowCutover,
} from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';

function count(value = 0) {
  return vi.fn().mockResolvedValue({ count: value });
}

describe('guarded escrow cutover', () => {
  it('selects the deployment environment family for Base and Base Sepolia', () => {
    expect(escrowCutoverDeploymentEnvKeys('base')).toMatchObject({
      escrowAddress: 'PUBLIC_ESCROW_ADDRESS',
      escrowDeploymentBlock: 'PUBLIC_ESCROW_DEPLOYMENT_BLOCK',
      preAddress: 'PUBLIC_PRE_ADDRESS',
      usdcAddress: 'PUBLIC_USDC_ADDRESS',
    });
    expect(escrowCutoverDeploymentEnvKeys('base-sepolia')).toMatchObject({
      escrowAddress: 'ESCROW_ADDRESS_TESTNET',
      escrowDeploymentBlock: 'ESCROW_DEPLOYMENT_BLOCK_TESTNET',
      preAddress: 'PRE_ADDRESS_TESTNET',
      usdcAddress: 'USDC_ADDRESS_TESTNET',
    });
  });

  it('allows reset only when no indexed goals, liabilities or active workflows remain', async () => {
    const fundingGoalCount = vi.fn().mockResolvedValue(0);
    const database = {
      fundingGoal: { count: fundingGoalCount },
      payout: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([
          { asset: FundingAsset.PRE, amountRaw: '100' },
          { asset: FundingAsset.USDC, amountRaw: '50' },
        ]),
      },
      safePayoutProposal: { count: vi.fn().mockResolvedValue(0) },
      safeGoalManagerProposal: { count: vi.fn().mockResolvedValue(0) },
      safeGoalActionProposal: { count: vi.fn().mockResolvedValue(0) },
      safeGoalManagerIntent: { count: vi.fn().mockResolvedValue(0) },
      safeGoalActionIntent: { count: vi.fn().mockResolvedValue(0) },
      cryptoContribution: {
        findMany: vi.fn().mockResolvedValue([
          { asset: FundingAsset.PRE, amountRaw: '100' },
          { asset: FundingAsset.USDC, amountRaw: '50' },
        ]),
      },
    } as never;

    const blockers = await escrowCutoverBlockers(database, 84532);

    expect(fundingGoalCount).toHaveBeenCalledWith({ where: { chainId: 84532 } });

    expect(blockers).toMatchObject({
      indexedGoals: 0,
      openGoals: 0,
      projectedPreLiabilityRaw: '0',
      projectedUsdcLiabilityRaw: '0',
    });
    expect(hasEscrowCutoverBlockers(blockers)).toBe(false);

    const blocked = { ...blockers, indexedGoals: 1 };
    expect(hasEscrowCutoverBlockers(blocked)).toBe(true);
  });

  it('removes every goal for the retired chain while preserving drafts and audit history', async () => {
    const fundingGoalFindMany = vi.fn().mockResolvedValue([
      { id: 'goal-1', expenseId: 'draft-1' },
      { id: 'goal-2', expenseId: null },
    ]);
    const fundingGoalDeleteMany = count(2);
    const expenseUpdateMany = count(1);
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const database = {
      fundingGoal: { findMany: fundingGoalFindMany, deleteMany: fundingGoalDeleteMany },
      expense: { updateMany: expenseUpdateMany },
      safeGoalActionProposal: { deleteMany: count() },
      safeGoalActionIntent: { deleteMany: count() },
      safePayoutProposal: { deleteMany: count() },
      safePayoutIntent: { deleteMany: count() },
      safeGoalManagerProposal: { deleteMany: count() },
      safeGoalManagerIntent: { deleteMany: count() },
      goalManagerAssignment: { deleteMany: count() },
      payout: { deleteMany: count() },
      fundingGoalPeriod: { deleteMany: count() },
      cryptoContribution: { deleteMany: count() },
      sponsorProfile: { updateMany: count() },
      chainAuthority: { deleteMany: count() },
      chainEvent: { deleteMany: count() },
      indexerState: { deleteMany: count() },
      auditEvent: { create: auditCreate },
    } as never;

    const result = await resetForEscrowCutover(database, {
      chainId: 84532,
      newEscrowAddress: '0x0000000000000000000000000000000000000010',
      newDeploymentBlock: '100',
    });

    expect(fundingGoalFindMany).toHaveBeenCalledWith({
      where: { chainId: 84532 },
      select: { id: true, expenseId: true },
    });
    expect(fundingGoalDeleteMany).toHaveBeenCalledWith({ where: { chainId: 84532 } });
    expect(expenseUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['draft-1'] } }),
        data: expect.objectContaining({ status: 'DRAFT', pendingChainGoalId: null }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ESCROW_GUARDED_CUTOVER_RESET' }),
    });
    expect(result).toMatchObject({ fundingGoals: 2, drafts: 1 });
  });
});
