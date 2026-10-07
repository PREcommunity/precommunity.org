import { expect, it, vi } from 'vitest';
import { indexEscrow } from './indexer';

const rpc = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
  getContractEvents: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => rpc,
}));

vi.mock('./escrow-manifest', () => ({
  verifyEscrowManifest: vi.fn().mockResolvedValue({}),
}));

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      deployment: {
        ...actual.config.deployment,
        escrowAddress: '0x0000000000000000000000000000000000000010',
        deploymentBlock: '100',
        preAddress: '0x0000000000000000000000000000000000000001',
        usdcAddress: '0x0000000000000000000000000000000000000002',
        owner: '0x0000000000000000000000000000000000000003',
        treasury: '0x0000000000000000000000000000000000000004',
        confirmations: 6,
      },
    },
  };
});

it('indexes contiguous ranges of at most 500 inclusive blocks and resumes after its checkpoint', async () => {
  const hash = `0x${'ab'.repeat(32)}`;
  let checkpoint: { lastBlockNumber: bigint; lastBlockHash: string } | null = null;
  const upsert = vi.fn().mockImplementation(async ({ update }) => {
    checkpoint = update;
  });
  const database = {
    indexerState: {
      findUnique: vi.fn().mockImplementation(async () => checkpoint),
      upsert,
    },
  };
  rpc.getBlockNumber.mockResolvedValueOnce(1207n).mockResolvedValueOnce(1606n);
  rpc.getBlock.mockResolvedValue({ hash });
  rpc.getContractEvents.mockImplementation(
    async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      if (toBlock - fromBlock + 1n > 500n) throw new Error('Provider block range limit exceeded');
      return [];
    },
  );

  await expect(indexEscrow(database as never)).resolves.toEqual({
    processed: 0,
    status: 'SYNCED',
    indexedThroughBlock: '1201',
  });
  await expect(indexEscrow(database as never)).resolves.toEqual({
    processed: 0,
    status: 'SYNCED',
    indexedThroughBlock: '1600',
  });

  expect(
    rpc.getContractEvents.mock.calls.map(([{ fromBlock, toBlock }]) => [fromBlock, toBlock]),
  ).toEqual([
    [100n, 599n],
    [600n, 1099n],
    [1100n, 1201n],
    [1202n, 1600n],
  ]);
  expect(upsert.mock.calls.map(([{ update }]) => update.lastBlockNumber)).toEqual([
    599n,
    1099n,
    1201n,
    1600n,
  ]);
});
