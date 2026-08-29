import { describe, expect, it } from 'vitest';
import { AwaitingContractAdsChainAdapter, type AdsStakeTransactionPlan } from './ads-chain.adapter';

describe('PRE Keyword Market disabled contract adapter', () => {
  const adapter = new AwaitingContractAdsChainAdapter();
  const position = {
    canonicalKeyword: 'bitcoin',
    stakerAddress: '0x0000000000000000000000000000000000000001',
  };

  it('never exposes an unconfirmed position before the contract handoff', async () => {
    expect(adapter.snapshot()).toMatchObject({
      status: 'AWAITING_CONTRACT',
      transactionsEnabled: false,
    });
    await expect(adapter.position(position)).resolves.toBeNull();
  });

  it('defines every stake operation without manufacturing transaction calldata', async () => {
    await expect(adapter.createStake({ ...position, amountRaw: '100' })).resolves.toEqual({
      status: 'AWAITING_CONTRACT',
      operation: 'CREATE_STAKE',
      enabled: false,
      transaction: null,
    });
    await expect(adapter.increaseStake({ ...position, amountRaw: '50' })).resolves.toMatchObject({
      operation: 'INCREASE_STAKE',
      enabled: false,
    });
    await expect(adapter.unstake(position)).resolves.toMatchObject({
      operation: 'UNSTAKE',
      enabled: false,
    });
  });

  it('allows a future contract adapter to return prepared transaction calldata', () => {
    const plan: AdsStakeTransactionPlan = {
      status: 'READY',
      operation: 'CREATE_STAKE',
      enabled: true,
      transaction: {
        chainId: 8453,
        to: '0x0000000000000000000000000000000000000001',
        data: '0x1234',
        valueRaw: '0',
      },
    };

    expect(plan.transaction.data).toBe('0x1234');
  });
});
