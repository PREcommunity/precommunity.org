import { describe, expect, it, vi } from 'vitest';
import { PRE_KEYWORD_MARKET_ABI, adKeywordId } from '@precommunity/shared';
import { decodeFunctionData, erc20Abi } from 'viem';
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
  configBlockNumber: 100n,
  minimumStakeRaw: '1000000000000000000',
  paused: false,
  operatorAddress: '0x0000000000000000000000000000000000000000',
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

function replaceRpc(instance: ContractAdsChainAdapter, readContract = vi.fn()) {
  (instance as unknown as { publicClient: unknown }).publicClient = { readContract };
  return readContract;
}

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
      expect(rpc).toHaveBeenCalledTimes(3);
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
