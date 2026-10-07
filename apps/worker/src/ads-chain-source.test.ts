import { describe, expect, it, vi } from 'vitest';
import { ContractAdsChainSource } from './ads-chain-source';

const marketAddress = '0x0000000000000000000000000000000000000099';
const safeAddress = '0x0000000000000000000000000000000000000003';
const preAddress = '0x5471386EA2022e724A234A7690E338aA0A6689aD';
const keywordId = `0x${'1'.repeat(64)}` as const;
const blockHash = `0x${'2'.repeat(64)}` as const;
const transactionHash = `0x${'3'.repeat(64)}` as const;

function chainClient(head = 110n) {
  return {
    getChainId: vi.fn().mockResolvedValue(84532),
    getBytecode: vi.fn().mockResolvedValue('0x6000'),
    getBlockNumber: vi.fn().mockResolvedValue(head),
    readContract: vi.fn(({ functionName }: { functionName: string }) => {
      if (functionName === 'PRE') return Promise.resolve(preAddress);
      if (functionName === 'owner') return Promise.resolve(safeAddress);
      if (functionName === 'minimumStake') return Promise.resolve(10n ** 18n);
      if (functionName === 'paused') return Promise.resolve(false);
      if (functionName === 'operator') return Promise.resolve(safeAddress);
      throw new Error(`Unexpected read ${functionName}`);
    }),
    getBlock: vi.fn().mockResolvedValue({ hash: blockHash }),
    getContractEvents: vi.fn().mockResolvedValue([
      {
        args: {
          keywordId,
          staker: '0x0000000000000000000000000000000000000001',
          previousStake: 0n,
          newStake: 10n ** 18n,
          bidUsd: 2_500_000n,
          requiredCoveragePre: 2n * 10n ** 18n,
          eligible: true,
          withdrawAvailableAt: 0n,
          positionVersion: 1n,
        },
        blockNumber: 101n,
        blockHash,
        transactionHash,
        logIndex: 2,
      },
    ]),
  };
}

type TestCheckpoint = { lastBlockNumber: bigint; lastBlockHash: string };

function projectionDatabase(state: TestCheckpoint | null = null) {
  let checkpoint = state;
  const tx = {
    adChainEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn() },
    adStakePosition: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    adIndexerState: {
      findUnique: vi.fn(() => Promise.resolve(checkpoint)),
      upsert: vi.fn(({ create, update }: { create: TestCheckpoint; update: TestCheckpoint }) => {
        checkpoint = checkpoint ? { ...checkpoint, ...update } : create;
        return Promise.resolve(checkpoint);
      }),
      deleteMany: vi.fn(() => {
        const count = checkpoint ? 1 : 0;
        checkpoint = null;
        return Promise.resolve({ count });
      }),
    },
  };
  const database = {
    adIndexerState: { findUnique: vi.fn(() => Promise.resolve(checkpoint)) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { database, tx };
}

describe('PRE Keyword Market chain source', () => {
  it('starts at the deployment block and scans only finalized events', async () => {
    const client = chainClient();
    const { database, tx } = projectionDatabase();

    await expect(
      new ContractAdsChainSource(client as never).index(database as never),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'SYNCED',
        processed: 1,
        indexedThroughBlock: '104',
      }),
    );
    expect(client.getContractEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        address: marketAddress,
        fromBlock: 100n,
        toBlock: 104n,
        eventName: 'PositionChanged',
      }),
    );
    expect(tx.adStakePosition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          keywordId,
          stakeRaw: (10n ** 18n).toString(),
          bidUsdRaw: '2500000',
          requiredCoveragePreRaw: (2n * 10n ** 18n).toString(),
          eligible: true,
          withdrawAvailableAt: 0n,
          positionVersion: 1n,
        }),
      }),
    );
    expect(tx.adIndexerState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          minimumStakeRaw: (10n ** 18n).toString(),
          paused: false,
          operatorAddress: safeAddress,
          configBlockNumber: 104n,
        }),
      }),
    );
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'paused',
        blockNumber: 104n,
      }),
    );
    expect(database.$transaction).toHaveBeenCalledOnce();
  });

  it('stays syncing until the deployment block has enough confirmations', async () => {
    const client = chainClient(105n);
    const { database } = projectionDatabase();

    await expect(
      new ContractAdsChainSource(client as never).index(database as never),
    ).resolves.toEqual(expect.objectContaining({ status: 'SYNCING', processed: 0 }));
    expect(client.getContractEvents).not.toHaveBeenCalled();
  });

  it('resumes finalized position events across provider-limited 500-block chunks', async () => {
    const client = chainClient(1_106n);
    const [initialEvent] = await client.getContractEvents();
    const events = [599n, 600n, 1_100n].map((blockNumber, index) => ({
      ...initialEvent,
      blockNumber,
      transactionHash: `0x${String(index + 4).repeat(64)}` as typeof transactionHash,
      args: {
        ...initialEvent.args,
        previousStake: BigInt(index) * 10n ** 18n,
        newStake: BigInt(index + 1) * 10n ** 18n,
        positionVersion: BigInt(index + 1),
      },
    }));
    client.getContractEvents.mockClear();
    let interrupted = false;
    client.getContractEvents.mockImplementation(
      ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 500n) throw new Error('RPC range exceeds 500 blocks');
        if (fromBlock === 1_100n && !interrupted) {
          interrupted = true;
          throw new Error('RPC interrupted');
        }
        return Promise.resolve(
          events.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock),
        );
      },
    );
    const { database, tx } = projectionDatabase();
    const source = new ContractAdsChainSource(client as never);

    await expect(source.index(database as never)).rejects.toThrow('RPC interrupted');
    expect(tx.adStakePosition.upsert).toHaveBeenCalledTimes(2);
    expect(tx.adIndexerState.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastBlockNumber: 1_099n }),
      }),
    );

    await expect(source.index(database as never)).resolves.toEqual(
      expect.objectContaining({ status: 'SYNCED', processed: 1, indexedThroughBlock: '1100' }),
    );
    expect(
      client.getContractEvents.mock.calls.map(([request]) => [request.fromBlock, request.toBlock]),
    ).toEqual([
      [100n, 599n],
      [600n, 1_099n],
      [1_100n, 1_100n],
      [1_100n, 1_100n],
    ]);
    expect(tx.adStakePosition.upsert).toHaveBeenCalledTimes(3);
    expect(tx.adStakePosition.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          stakeRaw: (3n * 10n ** 18n).toString(),
          positionVersion: 3n,
          positionBlock: 1_100n,
        }),
      }),
    );
    expect(tx.adIndexerState.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ configBlockNumber: 1_100n }),
      }),
    );
  });

  it('clears only market projection data and replays after a reorg', async () => {
    const client = chainClient();
    client.getBlock.mockResolvedValue({ hash: blockHash });
    const { database, tx } = projectionDatabase({
      lastBlockNumber: 104n,
      lastBlockHash: `0x${'f'.repeat(64)}`,
    });
    tx.adStakePosition.deleteMany.mockResolvedValue({ count: 1 });
    tx.adChainEvent.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      new ContractAdsChainSource(client as never).index(database as never),
    ).resolves.toEqual(expect.objectContaining({ status: 'SYNCED', processed: 1 }));
    expect(tx.adStakePosition.deleteMany).toHaveBeenCalledWith({
      where: { chainId: 84532, contractAddress: marketAddress },
    });
    expect(client.getContractEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 100n, toBlock: 104n }),
    );
  });

  it('does not persist mixed-chain events or advance the checkpoint during a reorg', async () => {
    const client = chainClient();
    client.getBlock.mockResolvedValueOnce({ hash: blockHash }).mockResolvedValueOnce({
      hash: `0x${'f'.repeat(64)}` as typeof blockHash,
    });
    const { database, tx } = projectionDatabase();

    await expect(
      new ContractAdsChainSource(client as never).index(database as never),
    ).rejects.toThrow('reorganized while reading position events');
    expect(tx.adStakePosition.upsert).not.toHaveBeenCalled();
    expect(tx.adIndexerState.upsert).not.toHaveBeenCalled();
  });

  it('refreshes confirmed configuration even when no new blocks need indexing', async () => {
    const client = chainClient();
    const { database, tx } = projectionDatabase({
      lastBlockNumber: 104n,
      lastBlockHash: blockHash,
    });
    client.readContract.mockImplementation(({ functionName }) => {
      if (functionName === 'PRE') return Promise.resolve(preAddress);
      if (functionName === 'owner') return Promise.resolve(safeAddress);
      if (functionName === 'minimumStake') return Promise.resolve(2n * 10n ** 18n);
      if (functionName === 'paused') return Promise.resolve(true);
      if (functionName === 'operator') return Promise.resolve(marketAddress);
      throw new Error(`Unexpected read ${functionName}`);
    });

    await expect(
      new ContractAdsChainSource(client as never).index(database as never),
    ).resolves.toEqual(expect.objectContaining({ status: 'SYNCED', processed: 0 }));
    expect(client.getContractEvents).not.toHaveBeenCalled();
    expect(tx.adIndexerState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          minimumStakeRaw: (2n * 10n ** 18n).toString(),
          paused: true,
          operatorAddress: marketAddress,
          configBlockNumber: 104n,
        }),
      }),
    );
  });

  it('does not mark an ahead-of-head checkpoint fresh while the RPC node is behind', async () => {
    const client = chainClient(109n);
    const { database, tx } = projectionDatabase({
      lastBlockNumber: 104n,
      lastBlockHash: blockHash,
    });

    await expect(
      new ContractAdsChainSource(client as never).index(database as never),
    ).resolves.toEqual(expect.objectContaining({ status: 'SYNCING', processed: 0 }));
    expect(tx.adIndexerState.upsert).not.toHaveBeenCalled();
    expect(client.getContractEvents).not.toHaveBeenCalled();
  });

  it('rejects a stable new fork in a later chunk and removes old-fork-only positions on retry', async () => {
    const client = chainClient(716n);
    const [forkALog] = await client.getContractEvents();
    const forkBHash = `0x${'f'.repeat(64)}` as const;
    const forkBKeywordId = `0x${'4'.repeat(64)}` as const;
    let fork = 'A';
    client.getBlock.mockImplementation(({ blockNumber }: { blockNumber: bigint }) => {
      if (blockNumber === 710n) fork = 'B';
      return Promise.resolve({ hash: fork === 'A' ? blockHash : forkBHash });
    });
    client.getContractEvents.mockImplementation(({ fromBlock }: { fromBlock: bigint }) => {
      if (fromBlock !== 100n) return Promise.resolve([]);
      return Promise.resolve([
        fork === 'A'
          ? forkALog
          : {
              ...forkALog,
              blockHash: forkBHash,
              args: { ...forkALog.args, keywordId: forkBKeywordId },
            },
      ]);
    });
    const { database, tx } = projectionDatabase();
    const positions = new Set<string>();
    tx.adStakePosition.upsert.mockImplementation(
      ({ create }: { create: { keywordId: string } }) => {
        positions.add(create.keywordId);
        return Promise.resolve({});
      },
    );
    tx.adStakePosition.deleteMany.mockImplementation(() => {
      const count = positions.size;
      positions.clear();
      return Promise.resolve({ count });
    });
    tx.adChainEvent.deleteMany.mockResolvedValue({ count: 1 });
    const source = new ContractAdsChainSource(client as never);

    await expect(source.index(database as never)).rejects.toThrow(
      'reorganized across indexed chunks',
    );
    expect(positions).toEqual(new Set([keywordId]));
    expect(tx.adIndexerState.upsert).toHaveBeenCalledOnce();
    expect(tx.adIndexerState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ lastBlockNumber: 599n, lastBlockHash: blockHash }),
      }),
    );

    await expect(source.index(database as never)).resolves.toEqual(
      expect.objectContaining({ status: 'SYNCED' }),
    );
    expect(tx.adStakePosition.deleteMany).toHaveBeenCalledOnce();
    expect(positions).toEqual(new Set([forkBKeywordId]));
    expect(tx.adIndexerState.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastBlockNumber: 710n, lastBlockHash: forkBHash }),
      }),
    );
  });

  it('checks the existing checkpoint again before its first new chunk', async () => {
    const client = chainClient(111n);
    client.getBlock.mockResolvedValueOnce({ hash: blockHash }).mockResolvedValue({
      hash: `0x${'f'.repeat(64)}` as typeof blockHash,
    });
    const { database, tx } = projectionDatabase({
      lastBlockNumber: 104n,
      lastBlockHash: blockHash,
    });

    await expect(
      new ContractAdsChainSource(client as never).index(database as never),
    ).rejects.toThrow('reorganized across indexed chunks');
    expect(client.getContractEvents).not.toHaveBeenCalled();
    expect(tx.adIndexerState.upsert).not.toHaveBeenCalled();
  });

  it('rejects a stale poll if another indexer replaces the checkpoint before its transaction', async () => {
    const client = chainClient();
    const { database, tx } = projectionDatabase();
    tx.adIndexerState.findUnique.mockResolvedValue({
      lastBlockNumber: 104n,
      lastBlockHash: blockHash,
    });

    await expect(
      new ContractAdsChainSource(client as never).index(database as never),
    ).rejects.toThrow('checkpoint changed during indexing');
    expect(tx.adChainEvent.createMany).not.toHaveBeenCalled();
    expect(tx.adStakePosition.upsert).not.toHaveBeenCalled();
    expect(tx.adIndexerState.upsert).not.toHaveBeenCalled();
  });
});
