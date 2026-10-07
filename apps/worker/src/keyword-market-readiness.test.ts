import { PRE_KEYWORD_MARKET_ABI } from '@precommunity/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  keywordMarketCheckPhase,
  normalizedMarketRuntime,
  verifyKeywordMarketReadiness,
  type KeywordMarketCheckOptions,
  type ReviewedMarketArtifact,
} from './keyword-market-readiness';

const address = '0x0000000000000000000000000000000000000099';
const preAddress = '0x0000000000000000000000000000000000000001';
const safeAddress = '0x0000000000000000000000000000000000000003';
const operator = '0x0000000000000000000000000000000000000000';
const blockHash = `0x${'ab'.repeat(32)}` as const;
const now = new Date('2026-10-06T12:00:00Z');
const minimumStake = 10n ** 18n;
const reviewed: ReviewedMarketArtifact = {
  artifact: {
    contractName: 'PREKeywordMarketV1',
    abi: PRE_KEYWORD_MARKET_ABI,
    deployedBytecode: `0x60${'00'.repeat(32)}610044`,
    immutableReferences: { PRE: [{ start: 1, length: 32 }] },
    buildInfoId: 'reviewed-build',
  },
  artifactSha256: '1'.repeat(64),
};
const runtime = `0x60${'ab'.repeat(32)}610044` as const;
const options: KeywordMarketCheckOptions = {
  chainId: 84532,
  contractAddress: address,
  deploymentBlock: '100',
  preAddress,
  safeAddress,
  confirmations: 6,
  phase: 'preopen',
  now,
};

function fixture(paused = true) {
  const state = {
    chainId: 84532,
    contractAddress: address,
    lastBlockNumber: 104n,
    lastBlockHash: blockHash,
    configBlockNumber: 104n,
    minimumStakeRaw: minimumStake.toString(),
    paused,
    operatorAddress: operator,
    updatedAt: now,
  };
  const database = { adIndexerState: { findUnique: vi.fn().mockResolvedValue(state) } };
  const values: Record<string, unknown> = {
    PRE: preAddress,
    owner: safeAddress,
    decimals: 18,
    minimumStake,
    paused,
    operator,
  };
  const client = {
    getChainId: vi.fn().mockResolvedValue(84532),
    getBlockNumber: vi.fn().mockResolvedValue(110n),
    getBytecode: vi.fn(
      ({ address: contract, blockNumber }: { address: string; blockNumber: bigint }) =>
        Promise.resolve(
          contract === address ? (blockNumber === 99n ? undefined : runtime) : '0x6000',
        ),
    ),
    readContract: vi.fn(({ functionName }: { functionName: string }) =>
      Promise.resolve(values[functionName]),
    ),
    getBlock: vi.fn().mockResolvedValue({ hash: blockHash }),
  };
  return { client, database, state, values };
}

describe('read-only Keyword Market production readiness', () => {
  it('checks a paused deployment and fresh canonical projection without consulting a feature flag', async () => {
    const { client, database } = fixture();
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, reviewed),
    ).resolves.toMatchObject({
      status: 'READY',
      phase: 'preopen',
      paused: true,
      chainId: 84532,
      contractAddress: address,
      indexedThroughBlock: '104',
      indexedBlockHash: blockHash,
      finalizedLagBlocks: '0',
      artifactSha256: '1'.repeat(64),
      buildInfoId: 'reviewed-build',
      abiSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      runtimeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'minimumStake', blockNumber: 104n }),
    );
  });

  it('allows active staking with no billing operator', async () => {
    const { client, database } = fixture(false);
    await expect(
      verifyKeywordMarketReadiness(
        client as never,
        database as never,
        { ...options, phase: 'active' },
        reviewed,
      ),
    ).resolves.toMatchObject({ status: 'READY', phase: 'active', operatorAddress: operator });
  });

  it('masks only compiler-declared immutable slots and rejects other runtime differences', async () => {
    expect(normalizedMarketRuntime(runtime, reviewed.artifact)).toBe(
      reviewed.artifact.deployedBytecode,
    );
    const { client, database } = fixture();
    client.getBytecode.mockImplementation(({ address: contract, blockNumber }) =>
      Promise.resolve(
        contract === address
          ? blockNumber === 99n
            ? undefined
            : (`${runtime.slice(0, -2)}45` as typeof runtime)
          : '0x6000',
      ),
    );
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, reviewed),
    ).rejects.toThrow('runtime differs');
    expect(() =>
      normalizedMarketRuntime(runtime, {
        ...reviewed.artifact,
        immutableReferences: { PRE: [{ start: 35, length: 32 }] },
      }),
    ).toThrow('reference is invalid');
  });

  it.each([
    ['minimum', { minimumStakeRaw: '2' }, 'cached configuration'],
    ['partial snapshot', { configBlockNumber: 103n }, 'not fully synchronized'],
    ['wrong deployment identity', { chainId: 8453 }, 'not fully synchronized'],
    ['stale timestamp', { updatedAt: new Date(now.getTime() - 60_001) }, 'stale or outside'],
    ['unfinalized cursor', { lastBlockNumber: 105n, configBlockNumber: 105n }, 'stale or outside'],
  ])('rejects %s', async (_label, override, message) => {
    const { client, database, state } = fixture();
    database.adIndexerState.findUnique.mockResolvedValue({ ...state, ...override });
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, reviewed),
    ).rejects.toThrow(String(message));
  });

  it('rejects a live chain lag hidden by a recent database timestamp', async () => {
    const { client, database } = fixture();
    client.getBlockNumber.mockResolvedValue(141n);
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, reviewed),
    ).rejects.toThrow('stale or outside');
  });

  it.each([
    ['PRE', safeAddress, 'token identity'],
    ['decimals', 6, 'token identity'],
    ['owner', preAddress, 'configured deployed Safe'],
  ])('rejects wrong %s', async (field, value, message) => {
    const { client, database, values } = fixture();
    values[String(field)] = value;
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, reviewed),
    ).rejects.toThrow(String(message));
  });

  it('requires the requested pause phase at the checkpoint and current head', async () => {
    const { client, database, values } = fixture();
    client.readContract.mockImplementation(
      ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) =>
        Promise.resolve(
          functionName === 'paused' && blockNumber === undefined ? false : values[functionName],
        ),
    );
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, reviewed),
    ).rejects.toThrow('must be paused');
  });

  it('rejects an incorrectly late deployment block that would skip old staking logs', async () => {
    const { client, database } = fixture();
    client.getBytecode.mockImplementation(({ address: contract }) =>
      Promise.resolve(contract === address ? runtime : '0x6000'),
    );
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, reviewed),
    ).rejects.toThrow('already exists before');
  });

  it('detects a reorg while verifying readiness', async () => {
    const { client, database } = fixture();
    client.getBlock
      .mockResolvedValueOnce({ hash: blockHash })
      .mockResolvedValueOnce({ hash: `0x${'cd'.repeat(32)}` });
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, reviewed),
    ).rejects.toThrow('reorganized during readiness');
  });

  it('rejects an artifact whose ABI is not the generated app ABI', async () => {
    const { client, database } = fixture();
    await expect(
      verifyKeywordMarketReadiness(client as never, database as never, options, {
        ...reviewed,
        artifact: { ...reviewed.artifact, abi: [] },
      }),
    ).rejects.toThrow('generated ABI differs');
  });

  it('parses only explicit supported phase arguments', () => {
    expect(keywordMarketCheckPhase([], 'active')).toBe('active');
    expect(keywordMarketCheckPhase([])).toBeUndefined();
    expect(keywordMarketCheckPhase(['--', '--phase', 'preopen'])).toBe('preopen');
    expect(() => keywordMarketCheckPhase(['--phase', 'anything'])).toThrow('Usage:');
  });
});
