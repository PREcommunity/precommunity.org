import { describe, expect, it, vi } from 'vitest';
import { adKeywordId } from '@precommunity/shared';
import {
  applyAdPositionChange,
  advanceAdsIndexerState,
  finalizedAdsBlock,
  projectFinalizedAdPositionChange,
  resetAdsProjectionAfterReorg,
  type AdPositionChange,
} from './ads-projection';

const baseChange: AdPositionChange = {
  chainId: 8453,
  contractAddress: '0x0000000000000000000000000000000000000099',
  keywordId: adKeywordId('BITCOIN—Poland'),
  stakerAddress: '0x0000000000000000000000000000000000000001',
  stakeRaw: '100',
  previousStakeRaw: '0',
  bidUsdRaw: '2500000',
  requiredCoveragePreRaw: '80',
  eligible: true,
  withdrawAvailableAt: 0n,
  positionVersion: 1n,
  blockNumber: 10n,
  blockHash: `0x${'1'.repeat(64)}`,
  txHash: `0x${'2'.repeat(64)}`,
  logIndex: 3,
};

describe('PRE Keyword Market position projection', () => {
  it('normalizes identity and records the event that established a new amount', async () => {
    const upsert = vi.fn();
    const database = {
      adStakePosition: { findUnique: vi.fn().mockResolvedValue(null), upsert },
    } as never;

    await expect(applyAdPositionChange(database, baseChange)).resolves.toEqual({
      applied: true,
      amountChanged: true,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          keywordId: adKeywordId('bitcoin poland'),
          stakeRaw: '100',
          bidUsdRaw: '2500000',
          requiredCoveragePreRaw: '80',
          eligible: true,
          withdrawAvailableAt: 0n,
          positionVersion: 1n,
          stakeSinceBlock: 10n,
          stakeSinceLogIndex: 3,
          amountSinceBlock: 10n,
          amountSinceLogIndex: 3,
          active: true,
        }),
      }),
    );
  });

  it.each([
    ['top-up', { stakeRaw: '150' }, true],
    ['charge', { stakeRaw: '80' }, true],
    ['bid update', { bidUsdRaw: '3500000' }, false],
    ['withdrawal request', { eligible: false, withdrawAvailableAt: 123n }, false],
  ] as const)('preserves opening priority after a %s', async (_, update, amountChanged) => {
    const upsert = vi.fn();
    const database = {
      adStakePosition: {
        findUnique: vi.fn().mockResolvedValue({
          stakeRaw: '100',
          positionVersion: 1n,
          stakeSinceBlock: 10n,
          stakeSinceLogIndex: 3,
          amountSinceBlock: 10n,
          amountSinceLogIndex: 3,
          positionBlock: 10n,
          positionLogIndex: 3,
        }),
        upsert,
      },
    } as never;

    await expect(
      applyAdPositionChange(database, {
        ...baseChange,
        ...update,
        previousStakeRaw: '100',
        blockNumber: 11n,
        logIndex: 0,
      }),
    ).resolves.toEqual({ applied: true, amountChanged });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          ...update,
          positionVersion: 1n,
          stakeSinceBlock: 10n,
          stakeSinceLogIndex: 3,
          amountSinceBlock: amountChanged ? 11n : 10n,
          amountSinceLogIndex: amountChanged ? 0 : 3,
        }),
      }),
    );
  });

  it.each([
    ['a zero-balance reopening', '0', 1n],
    ['a new position version', '100', 2n],
  ] as const)('resets opening priority for %s', async (_, previousStakeRaw, positionVersion) => {
    const upsert = vi.fn();
    const database = {
      adStakePosition: {
        findUnique: vi.fn().mockResolvedValue({
          stakeRaw: previousStakeRaw,
          positionVersion: 1n,
          stakeSinceBlock: 10n,
          stakeSinceLogIndex: 3,
          amountSinceBlock: 10n,
          amountSinceLogIndex: 3,
          positionBlock: 10n,
          positionLogIndex: 3,
        }),
        upsert,
      },
    } as never;

    await applyAdPositionChange(database, {
      ...baseChange,
      previousStakeRaw,
      positionVersion,
      blockNumber: 11n,
      logIndex: 0,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ stakeSinceBlock: 11n, stakeSinceLogIndex: 0 }),
      }),
    );
  });

  it('ignores stale/duplicate events and marks a confirmed zero stake inactive', async () => {
    const upsert = vi.fn();
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        stakeRaw: '100',
        positionVersion: 2n,
        stakeSinceBlock: 10n,
        stakeSinceLogIndex: 3,
        amountSinceBlock: 10n,
        amountSinceLogIndex: 3,
        positionBlock: 12n,
        positionLogIndex: 1,
      })
      .mockResolvedValueOnce({
        stakeRaw: '100',
        positionVersion: 2n,
        stakeSinceBlock: 10n,
        stakeSinceLogIndex: 3,
        amountSinceBlock: 10n,
        amountSinceLogIndex: 3,
        positionBlock: 12n,
        positionLogIndex: 1,
      });
    const database = { adStakePosition: { findUnique, upsert } } as never;

    await expect(applyAdPositionChange(database, baseChange)).resolves.toEqual({
      applied: false,
      reason: 'STALE_OR_DUPLICATE',
    });
    await applyAdPositionChange(database, {
      ...baseChange,
      stakeRaw: '0',
      bidUsdRaw: '0',
      eligible: false,
      withdrawAvailableAt: 0n,
      positionVersion: 2n,
      blockNumber: 13n,
      logIndex: 0,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ active: false, bidUsdRaw: '0', eligible: false }),
      }),
    );
  });

  it('claims the chain event atomically and skips a replay', async () => {
    const createMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const upsert = vi.fn();
    const tx = {
      adChainEvent: { createMany },
      adStakePosition: { findUnique: vi.fn().mockResolvedValue(null), upsert },
    };
    const database = {
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    } as never;

    await expect(projectFinalizedAdPositionChange(database, baseChange)).resolves.toEqual({
      applied: true,
      amountChanged: true,
    });
    await expect(projectFinalizedAdPositionChange(database, baseChange)).resolves.toEqual({
      applied: false,
      reason: 'DUPLICATE_EVENT',
    });
    expect(upsert).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            payload: expect.objectContaining({
              previousStakeRaw: '0',
              requiredCoveragePreRaw: '80',
            }),
          }),
        ],
      }),
    );
  });

  it('calculates a confirmation boundary and resets only ads projection tables after a reorg', async () => {
    expect(finalizedAdsBlock(100n, 12)).toBe(97n);
    expect(finalizedAdsBlock(100n, 4)).toBe(97n);
    expect(finalizedAdsBlock(100n, 1)).toBe(100n);
    expect(finalizedAdsBlock(3n, 4)).toBe(0n);
    expect(finalizedAdsBlock(2n, 4)).toBe(0n);
    expect(() => finalizedAdsBlock(100n, 0)).toThrow('positive integer');

    const tx = {
      adStakePosition: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      adChainEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      adIndexerState: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const database = {
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    } as never;

    await expect(
      resetAdsProjectionAfterReorg(database, {
        chainId: 8453,
        contractAddress: baseChange.contractAddress.toUpperCase(),
      }),
    ).resolves.toEqual({ positions: 2, events: 3, states: 1 });
    expect(tx.adStakePosition.deleteMany).toHaveBeenCalledWith({
      where: { chainId: 8453, contractAddress: baseChange.contractAddress },
    });
  });

  it('does not let a delayed concurrent poll overwrite a newer checkpoint and configuration', async () => {
    const current = { lastBlockNumber: 120n, minimumStakeRaw: '200', configBlockNumber: 120n };
    const upsert = vi.fn();
    const database = {
      adIndexerState: { findUnique: vi.fn().mockResolvedValue(current), upsert },
    } as never;
    await expect(
      advanceAdsIndexerState(database, baseChange, 119n, baseChange.blockHash, {
        minimumStakeRaw: '100',
        paused: false,
        operatorAddress: baseChange.stakerAddress,
        priceUpdaterAddress: baseChange.stakerAddress,
        preUsdPriceE18Raw: '10000000000000000',
        preUsdPriceQuotedAt: 1_791_804_000n,
        configBlockNumber: 119n,
      }),
    ).resolves.toBe(current);
    expect(upsert).not.toHaveBeenCalled();
  });
});
