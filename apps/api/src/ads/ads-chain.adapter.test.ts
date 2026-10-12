import { describe, expect, it, vi } from 'vitest';
import { PRE_KEYWORD_MARKET_ABI, adKeywordId } from '@precommunity/shared';
import { decodeFunctionData, erc20Abi, parseEther } from 'viem';
import {
  buildAdsStakeTransactionPlan,
  ContractAdsChainAdapter,
  parseAdsStakeAmount,
  parseAdsBidUsd,
} from './ads-chain.adapter';

const contractAddress = '0x0000000000000000000000000000000000000099';
const tokenAddress = '0x0000000000000000000000000000000000000001';
const keywordId = adKeywordId('bitcoin');
const query = { canonicalKeyword: 'bitcoin', stakerAddress: tokenAddress };
const syncedState = () => ({
  updatedAt: new Date(),
  lastBlockNumber: 100n,
  lastBlockHash: `0x${'c'.repeat(64)}`,
  configBlockNumber: 100n,
  minimumStakeRaw: '1000000000000000000',
  paused: false,
  operatorAddress: '0x0000000000000000000000000000000000000000',
  preUsdPriceE18Raw: '10000000000000000',
  preUsdPriceQuotedAt: BigInt(Math.floor(Date.now() / 1000)),
});

async function configuredAdapter(run: (Adapter: typeof ContractAdsChainAdapter) => Promise<void>) {
  vi.stubEnv('PRECOMMUNITY_NETWORK', 'base-sepolia');
  vi.stubEnv('ADS_CONTRACT_ADDRESS_TESTNET', contractAddress);
  vi.stubEnv('ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET', '10');
  vi.stubEnv('ADS_OPERATOR_PRIVATE_KEY', '');
  vi.resetModules();
  try {
    const { ContractAdsChainAdapter: Adapter } = await import('./ads-chain.adapter');
    await run(Adapter);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}

function replaceRpc(
  instance: ContractAdsChainAdapter,
  readContract = vi.fn(),
  quote = { price: 10n ** 18n, quotedAt: BigInt(Math.floor(Date.now() / 1000)) },
) {
  const rpc = vi.fn(async (request: { functionName: string; blockNumber?: bigint }) => {
    if (request.functionName === 'preUsdPriceE18') return quote.price;
    if (request.functionName === 'preUsdPriceQuotedAt') return quote.quotedAt;
    return readContract(request);
  });
  (instance as unknown as { publicClient: unknown }).publicClient = {
    getBlock: vi.fn().mockResolvedValue({ number: 123n }),
    readContract: rpc,
  };
  return rpc;
}

function projectionDatabase(state: unknown, positionRead = vi.fn()) {
  const tx = {
    adIndexerState: { findUnique: vi.fn().mockResolvedValue(state) },
    adStakePosition: { findUnique: positionRead },
  };
  return { ...tx, $transaction: vi.fn(async (run: (database: typeof tx) => unknown) => run(tx)) };
}

const billingQuery = {
  chainId: 84532,
  contractAddress,
  keywordId,
  stakerAddress: tokenAddress,
  positionVersion: '1',
};

function billingRpc(instance: ContractAdsChainAdapter) {
  const rpc = {
    getChainId: vi.fn().mockResolvedValue(84532),
    getBlock: vi.fn().mockResolvedValue({ number: 123n, hash: `0x${'a'.repeat(64)}` }),
    readContract: vi.fn(
      async ({ functionName }: { functionName: string; blockNumber?: bigint }) => {
        if (functionName === 'preUsdPriceE18') return 10n ** 16n;
        if (functionName === 'preUsdPriceQuotedAt') return 1_700_000_000n;
        return [100n, 250000n, 1n, false, 1000n, 1n];
      },
    ),
  };
  (instance as unknown as { billingClient: unknown }).billingClient = rpc;
  return rpc;
}

describe('current click bid capture', () => {
  it('reads the full position at the latest captured block and permits pending withdrawals', async () => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({} as never);
      const rpc = billingRpc(adapter);
      await expect(adapter.billingPosition(billingQuery)).resolves.toEqual({
        status: 'FOUND',
        bidUsdRaw: '250000',
        source: 'RPC',
        blockNumber: 123n,
        blockHash: `0x${'a'.repeat(64)}`,
        preUsdPriceE18: '10000000000000000',
        preUsdPriceQuotedAt: '1700000000',
      });
      expect(rpc.readContract.mock.calls).toHaveLength(3);
      expect(rpc.readContract.mock.calls.every(([request]) => request.blockNumber === 123n)).toBe(
        true,
      );
      expect(rpc.readContract).toHaveBeenCalledWith({
        address: contractAddress,
        abi: PRE_KEYWORD_MARKET_ABI,
        functionName: 'stakeDetailsOf',
        args: [keywordId, tokenAddress],
        blockNumber: 123n,
      });
    });
  });

  it.each([
    [[100n, 250000n, 1n, true, 0n, 2n], 'POSITION_VERSION_MISMATCH'],
    [[0n, 0n, 0n, false, 0n, 1n], 'POSITION_MISSING'],
  ])('never falls back after a definitive live position rejection', async (tuple, errorCode) => {
    await configuredAdapter(async (Adapter) => {
      const stateRead = vi.fn().mockResolvedValue(syncedState());
      const adapter = new Adapter({ adIndexerState: { findUnique: stateRead } } as never);
      const rpc = billingRpc(adapter);
      rpc.readContract.mockResolvedValue(tuple as never);
      await expect(adapter.billingPosition(billingQuery)).resolves.toEqual({
        status: 'UNAVAILABLE',
        errorCode,
      });
      expect(stateRead).not.toHaveBeenCalled();
    });
  });

  it('falls back only to a fresh synchronized projection of the original version', async () => {
    await configuredAdapter(async (Adapter) => {
      const state = syncedState();
      const projected = {
        stakeRaw: '100',
        bidUsdRaw: '123456',
        positionVersion: 1n,
        positionBlock: 99n,
        positionBlockHash: `0x${'b'.repeat(64)}`,
      };
      const projectionRead = vi.fn().mockResolvedValue(projected);
      const database = projectionDatabase(state, projectionRead);
      const adapter = new Adapter(database as never);
      const rpc = billingRpc(adapter);
      rpc.getBlock.mockRejectedValue(new Error('RPC unavailable'));
      await expect(adapter.billingPosition(billingQuery)).resolves.toEqual({
        status: 'FOUND',
        bidUsdRaw: '123456',
        source: 'PROJECTION',
        blockNumber: state.lastBlockNumber,
        blockHash: state.lastBlockHash,
        preUsdPriceE18: state.preUsdPriceE18Raw,
        preUsdPriceQuotedAt: state.preUsdPriceQuotedAt.toString(),
      });
      expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'RepeatableRead',
      });
      projected.positionVersion = 2n;
      await expect(adapter.billingPosition(billingQuery)).resolves.toMatchObject({
        errorCode: 'POSITION_VERSION_MISMATCH',
      });
      state.updatedAt = new Date(Date.now() - 60_001);
      projectionRead.mockClear();
      await expect(adapter.billingPosition(billingQuery)).resolves.toEqual({
        status: 'UNAVAILABLE',
        errorCode: 'CAPTURE_FAILED',
      });
      expect(projectionRead).not.toHaveBeenCalled();
    });
  });

  it('bounds a stalled RPC and does not trust a different deployment or wrong RPC network', async () => {
    await configuredAdapter(async (Adapter) => {
      vi.useFakeTimers();
      try {
        const adapter = new Adapter(projectionDatabase(null) as never);
        const rpc = billingRpc(adapter);
        rpc.getBlock.mockImplementation(() => new Promise(() => undefined));
        const capture = adapter.billingPosition(billingQuery);
        await vi.advanceTimersByTimeAsync(2_000);
        await expect(capture).resolves.toMatchObject({
          status: 'UNAVAILABLE',
          errorCode: 'CAPTURE_FAILED',
        });
        await expect(
          adapter.billingPosition({ ...billingQuery, chainId: 8453 }),
        ).resolves.toMatchObject({ errorCode: 'CONTRACT_MISMATCH' });
        rpc.getBlock.mockResolvedValue({ number: 123n, hash: `0x${'a'.repeat(64)}` });
        rpc.getChainId.mockResolvedValue(8453);
        await expect(adapter.billingPosition(billingQuery)).resolves.toMatchObject({
          errorCode: 'CHAIN_MISMATCH',
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('PRE Keyword Market contract adapter', () => {
  it('keeps transaction preparation disabled before a contract is configured', async () => {
    const adapter = new ContractAdsChainAdapter({} as never);
    await expect(adapter.snapshot()).resolves.toMatchObject({
      status: 'AWAITING_CONTRACT',
      transactionsEnabled: false,
    });
    await expect(adapter.position(query)).resolves.toBeNull();
    for (const action of [
      adapter.stake({ ...query, amountRaw: '100', bidUsdRaw: '1000000' }),
      adapter.requestUnstake(query),
      adapter.unstake(query),
    ]) {
      await expect(action).resolves.toMatchObject({ status: 'AWAITING_CONTRACT', enabled: false });
    }
  });

  it('reads status and wallet position from Prisma without RPC or an operator signer', async () => {
    await configuredAdapter(async (Adapter) => {
      const state = syncedState();
      const findUnique = vi.fn().mockResolvedValue({
        stakeRaw: '2000000000000000000',
        bidUsdRaw: '1500000',
        requiredCoveragePreRaw: '1000000000000000000',
        eligible: true,
        withdrawAvailableAt: 0n,
        positionVersion: 2n,
        active: true,
      });
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(state) },
        adStakePosition: { findUnique },
      } as never);
      const rpc = replaceRpc(adapter);
      await expect(adapter.snapshot()).resolves.toMatchObject({
        status: 'SYNCED',
        transactionsEnabled: true,
        minimumStakeRaw: state.minimumStakeRaw,
        indexedThroughBlock: '100',
        paused: false,
      });
      await expect(adapter.position(query)).resolves.toMatchObject({
        stakeRaw: '2000000000000000000',
        requiredCoveragePreRaw: '1000000000000000000',
        positionVersion: '2',
      });
      expect(findUnique).toHaveBeenCalledWith({
        where: {
          chainId_contractAddress_keywordId_stakerAddress: {
            chainId: 84532,
            contractAddress,
            keywordId,
            stakerAddress: tokenAddress,
          },
        },
      });
      expect(rpc).not.toHaveBeenCalled();
      state.paused = true;
      await expect(adapter.snapshot()).resolves.toMatchObject({
        status: 'SYNCED',
        transactionsEnabled: false,
        paused: true,
      });
    });
  });

  it('does not report partial catch-up, missing configuration or an expired worker heartbeat as synced', async () => {
    await configuredAdapter(async (Adapter) => {
      for (const state of [
        null,
        { ...syncedState(), configBlockNumber: 99n },
        { ...syncedState(), minimumStakeRaw: null },
        { ...syncedState(), updatedAt: new Date(Date.now() - 60_001) },
      ]) {
        const adapter = new Adapter({
          adIndexerState: { findUnique: vi.fn().mockResolvedValue(state) },
        } as never);
        const rpc = replaceRpc(adapter);
        await expect(adapter.snapshot()).resolves.toMatchObject({
          status: 'SYNCING',
          transactionsEnabled: false,
        });
        await expect(
          adapter.stake({ ...query, amountRaw: '1', bidUsdRaw: '1' }),
        ).resolves.toMatchObject({ status: 'SYNCING', enabled: false });
        expect(rpc).not.toHaveBeenCalled();
      }
    });
  });

  it('prepares the current unsigned stake and permits a zero-deposit bid change', async () => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
      } as never);
      const rpc = replaceRpc(
        adapter,
        vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'stakeDetailsOf')
            return [
              2_000_000_000_000_000_000n,
              1_000_000n,
              1_000_000_000_000_000_000n,
              true,
              0n,
              1n,
            ];
          if (functionName === 'minimumStake') return 1_000_000_000_000_000_000n;
          if (functionName === 'paused') return false;
          throw new Error(`Unexpected RPC method ${functionName}`);
        }),
      );
      const plan = await adapter.stake({ ...query, amountRaw: '0', bidUsdRaw: '1500000' });
      if (!plan.enabled) throw new Error('Expected ready plan');
      expect(plan.approvalTransaction).toBeNull();
      expect(
        decodeFunctionData({ abi: PRE_KEYWORD_MARKET_ABI, data: plan.transaction.data }),
      ).toEqual({ functionName: 'stake', args: [keywordId, 0n, 1_500_000n] });
      expect(rpc).toHaveBeenCalledTimes(5);
    });
  });

  it.each([
    [0n, true],
    [99n, true],
    [100n, false],
    [101n, false],
    [(1n << 256n) - 1n, false],
  ])(
    'requires approval for allowance %s only when below the deposit',
    async (allowance, approvalRequired) => {
      await configuredAdapter(async (Adapter) => {
        const adapter = new Adapter({
          adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
        } as never);
        const rpc = replaceRpc(
          adapter,
          vi.fn(async ({ functionName }: { functionName: string }) => {
            if (functionName === 'stakeDetailsOf') return [100n, 1n, 1n, true, 0n, 1n];
            if (functionName === 'minimumStake') return 1n;
            if (functionName === 'paused') return false;
            if (functionName === 'allowance') return allowance;
            throw new Error(`Unexpected RPC method ${functionName}`);
          }),
          { price: 10n ** 28n, quotedAt: BigInt(Math.floor(Date.now() / 1000)) },
        );
        const plan = await adapter.stake({ ...query, amountRaw: '100', bidUsdRaw: '1' });
        if (!plan.enabled) throw new Error('Expected ready plan');
        expect(Boolean(plan.approvalTransaction)).toBe(approvalRequired);
        expect(rpc).toHaveBeenCalledWith({
          address: plan.tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [query.stakerAddress, contractAddress],
          blockNumber: 123n,
        });
        if (plan.approvalTransaction) {
          expect(
            decodeFunctionData({ abi: erc20Abi, data: plan.approvalTransaction.data }),
          ).toEqual({
            functionName: 'approve',
            args: [contractAddress, 100n],
          });
        }
      });
    },
  );

  it('reads allowance again when preparing a stake after approval', async () => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
      } as never);
      let allowance = 0n;
      const rpc = replaceRpc(
        adapter,
        vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'stakeDetailsOf') return [100n, 1n, 1n, true, 0n, 1n];
          if (functionName === 'minimumStake') return 1n;
          if (functionName === 'paused') return false;
          if (functionName === 'allowance') return allowance;
          throw new Error(`Unexpected RPC method ${functionName}`);
        }),
        { price: 10n ** 28n, quotedAt: BigInt(Math.floor(Date.now() / 1000)) },
      );
      const input = { ...query, amountRaw: '100', bidUsdRaw: '1' };
      const first = await adapter.stake(input);
      expect(first.enabled && first.approvalTransaction).toBeTruthy();
      allowance = (1n << 256n) - 1n;
      await expect(adapter.stake(input)).resolves.toMatchObject({
        enabled: true,
        approvalTransaction: null,
      });
      expect(
        rpc.mock.calls.filter(([request]) => request.functionName === 'allowance'),
      ).toHaveLength(2);
    });
  });

  it.each([
    ['new stake', '0', '100'],
    ['bid-only update', '100', '0'],
    ['insufficient top-up', '100', '79'],
  ])('rejects an underfunded %s before allowance preparation', async (_name, existing, deposit) => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
      } as never);
      const rpc = replaceRpc(
        adapter,
        vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'stakeDetailsOf')
            return [parseEther(existing), 1n, 1n, true, 0n, 1n];
          if (functionName === 'minimumStake') return parseEther('1');
          if (functionName === 'paused') return false;
          throw new Error(`Unexpected RPC method ${functionName}`);
        }),
      );
      await expect(
        adapter.stake({
          ...query,
          amountRaw: parseEther(deposit).toString(),
          bidUsdRaw: '180000000',
        }),
      ).rejects.toThrow(
        `One click requires 180 PRE; your resulting stake is ${Number(existing) + Number(deposit)} PRE. Add ${180 - Number(existing) - Number(deposit)} PRE or lower your bid.`,
      );
      expect(rpc.mock.calls.some(([request]) => request.functionName === 'allowance')).toBe(false);
      expect(rpc.mock.calls.every(([request]) => request.blockNumber === 123n)).toBe(true);
    });
  });

  it('includes the old quote timestamp in an underfunded stake error before approval', async () => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
      } as never);
      const quotedAt = BigInt(Math.floor(Date.now() / 1000) - 31 * 60);
      const rpc = replaceRpc(
        adapter,
        vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'stakeDetailsOf') return [parseEther('100'), 1n, 1n, true, 0n, 1n];
          if (functionName === 'minimumStake') return parseEther('1');
          if (functionName === 'paused') return false;
          throw new Error(`Unexpected RPC method ${functionName}`);
        }),
        { price: parseEther('1'), quotedAt },
      );
      await expect(
        adapter.stake({ ...query, amountRaw: '0', bidUsdRaw: '180000000' }),
      ).rejects.toMatchObject({
        status: 400,
        message: `One click requires 180 PRE; your resulting stake is 100 PRE. Add 80 PRE or lower your bid. The contract's PRE/USD price is older than 30 minutes (updated ${new Date(Number(quotedAt) * 1000).toISOString()}). This stake uses that price.`,
      });
      expect(rpc.mock.calls.some(([request]) => request.functionName === 'allowance')).toBe(false);
    });
  });

  it('allows equality after a sufficient top-up and warns while still using an old contract price', async () => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
      } as never);
      replaceRpc(
        adapter,
        vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'stakeDetailsOf') return [parseEther('100'), 1n, 1n, true, 0n, 1n];
          if (functionName === 'minimumStake') return parseEther('1');
          if (functionName === 'paused') return false;
          if (functionName === 'allowance') return parseEther('80');
          throw new Error(`Unexpected RPC method ${functionName}`);
        }),
        { price: parseEther('1'), quotedAt: BigInt(Math.floor(Date.now() / 1000) - 31 * 60) },
      );
      await expect(
        adapter.stake({ ...query, amountRaw: parseEther('80').toString(), bidUsdRaw: '180000000' }),
      ).resolves.toMatchObject({
        enabled: true,
        approvalTransaction: null,
        priceWarning: expect.stringContaining('older than 30 minutes'),
      });
    });
  });

  it('rejects a re-prepared stake if a charge reduced the existing position after approval', async () => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
      } as never);
      let currentAmount = parseEther('1');
      const rpc = replaceRpc(
        adapter,
        vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'stakeDetailsOf') return [currentAmount, 1n, 1n, true, 0n, 1n];
          if (functionName === 'minimumStake') return parseEther('1');
          if (functionName === 'paused') return false;
          if (functionName === 'allowance') return 0n;
          throw new Error(`Unexpected RPC method ${functionName}`);
        }),
      );
      const input = { ...query, amountRaw: parseEther('0.1').toString(), bidUsdRaw: '1000000' };
      await expect(adapter.stake(input)).resolves.toMatchObject({
        enabled: true,
        approvalTransaction: expect.any(Object),
      });
      currentAmount = parseEther('0.5');
      rpc.mockClear();
      await expect(adapter.stake(input)).rejects.toThrow(
        'One click requires 1 PRE; your resulting stake is 0.6 PRE. Add 0.4 PRE',
      );
      expect(rpc.mock.calls.some(([request]) => request.functionName === 'allowance')).toBe(false);
    });
  });

  it.each([
    { price: 0n, quotedAt: 1n },
    { price: parseEther('1'), quotedAt: 0n },
    { price: parseEther('1'), quotedAt: BigInt(Math.floor(Date.now() / 1000) + 3600) },
  ])('blocks staking when the contract price is missing or invalid', async (quote) => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
      } as never);
      const rpc = replaceRpc(
        adapter,
        vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'stakeDetailsOf') return [parseEther('100'), 1n, 1n, true, 0n, 1n];
          if (functionName === 'minimumStake') return parseEther('1');
          if (functionName === 'paused') return false;
          throw new Error(`Unexpected RPC method ${functionName}`);
        }),
        quote,
      );
      await expect(
        adapter.stake({ ...query, amountRaw: '0', bidUsdRaw: '1000000' }),
      ).rejects.toMatchObject({
        status: 503,
        message: 'The contract has no valid PRE/USD price yet.',
      });
      expect(rpc.mock.calls.some(([request]) => request.functionName === 'allowance')).toBe(false);
    });
  });

  it('validates fresh pause/minimum and pending withdrawal state before a stake', async () => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(syncedState()) },
      } as never);
      let amount = 0n;
      let withdrawal = 0n;
      let paused = true;
      replaceRpc(
        adapter,
        vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'stakeDetailsOf') return [amount, 1n, 1n, true, withdrawal, 1n];
          return functionName === 'paused' ? paused : 2_000_000_000_000_000_000n;
        }),
      );
      const input = { ...query, amountRaw: '1000000000000000000', bidUsdRaw: '1' };
      await expect(adapter.stake(input)).rejects.toThrow('staking is paused');
      paused = false;
      await expect(adapter.stake(input)).rejects.toThrow('at least 2000000000000000000');
      amount = 1n;
      withdrawal = 100n;
      await expect(adapter.stake(input)).rejects.toThrow('awaiting withdrawal');
    });
  });

  it('keeps withdrawal available while the worker is syncing and the contract is paused', async () => {
    await configuredAdapter(async (Adapter) => {
      const adapter = new Adapter({
        adIndexerState: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never);
      let availableAt = 0n;
      replaceRpc(
        adapter,
        vi.fn().mockImplementation(async () => [100n, 1n, 1n, false, availableAt, 1n]),
      );
      await expect(adapter.requestUnstake(query)).resolves.toMatchObject({
        enabled: true,
        operation: 'REQUEST_UNSTAKE',
      });
      await expect(adapter.unstake(query)).rejects.toThrow('Request unstake');
      availableAt = BigInt(Math.floor(Date.now() / 1000)) + 60n;
      await expect(adapter.requestUnstake(query)).rejects.toThrow('already requested');
      await expect(adapter.unstake(query)).rejects.toThrow('has not ended');
      availableAt = 1n;
      await expect(adapter.unstake(query)).resolves.toMatchObject({
        enabled: true,
        operation: 'UNSTAKE',
      });
    });
  });

  it('rejects malformed and overflowing uint256 values', () => {
    expect(parseAdsStakeAmount('0')).toBe('0');
    expect(parseAdsBidUsd('1')).toBe('1');
    for (const value of ['-1', '01', '1.1', String(1n << 256n)]) {
      expect(() => parseAdsStakeAmount(value)).toThrow();
      expect(() => parseAdsBidUsd(value)).toThrow();
    }
    expect(() => parseAdsBidUsd('0')).toThrow('positive integer');
  });

  it('encodes exact approval and the deployed three-argument stake selector', () => {
    const plan = buildAdsStakeTransactionPlan({
      operation: 'STAKE',
      chainId: 84532,
      contractAddress,
      tokenAddress,
      keywordId,
      amountRaw: '1000000000000000000',
      bidUsdRaw: '1500000',
      approvalRequired: true,
    });
    expect(decodeFunctionData({ abi: erc20Abi, data: plan.approvalTransaction!.data })).toEqual({
      functionName: 'approve',
      args: [contractAddress, 1_000_000_000_000_000_000n],
    });
    expect(plan.transaction.data.slice(0, 10)).toBe('0x2daedd52');
    expect(
      decodeFunctionData({ abi: PRE_KEYWORD_MARKET_ABI, data: plan.transaction.data }),
    ).toEqual({ functionName: 'stake', args: [keywordId, 1_000_000_000_000_000_000n, 1_500_000n] });
  });

  it('encodes two-step withdrawal without an approval', () => {
    for (const [operation, functionName] of [
      ['REQUEST_UNSTAKE', 'requestUnstake'],
      ['UNSTAKE', 'unstake'],
    ] as const) {
      const plan = buildAdsStakeTransactionPlan({
        operation,
        chainId: 84532,
        contractAddress,
        tokenAddress,
        keywordId,
        approvalRequired: false,
      });
      expect(plan.approvalTransaction).toBeNull();
      expect(
        decodeFunctionData({ abi: PRE_KEYWORD_MARKET_ABI, data: plan.transaction.data }),
      ).toEqual({ functionName, args: [keywordId] });
    }
  });
});
