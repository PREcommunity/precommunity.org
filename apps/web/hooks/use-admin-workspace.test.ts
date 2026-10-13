import type { DeploymentOverrides } from '@precommunity/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeDeployment } from '@/lib/deployment';
import { ApiError } from '@/lib/http';
import { useAdminWorkspace } from './use-admin-workspace';

const hooks = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown; update: (next: unknown) => void }>,
  stateIndex: 0,
}));
const api = vi.hoisted(() => vi.fn());
const wallet = vi.hoisted(() => ({
  address: `0x${'55'.repeat(20)}` as const,
  sendTransactionAsync: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const cell = (hooks.states[hooks.stateIndex++] ??= {
      value: initial,
      update: (next: unknown) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      },
    });
    return [cell.value, cell.update];
  },
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: wallet.address, chainId: 84532, isConnected: true }),
  useSwitchChain: () => ({}),
  useSendTransaction: () => ({ sendTransactionAsync: wallet.sendTransactionAsync }),
  usePublicClient: () => ({ waitForTransactionReceipt: wallet.waitForTransactionReceipt }),
}));
vi.mock('@/lib/sign-safe-proposal', () => ({ signSafeProposal: vi.fn() }));
vi.mock('@/lib/deployment', async () => {
  const { deploymentForNetwork } = await import('@precommunity/shared');
  const { default: overrides } = await import('../tests/e2e-deployment.json');
  const deployment = deploymentForNetwork('base-sepolia', overrides as DeploymentOverrides);
  return {
    activeDeployment: deployment,
    activeChain: { id: deployment.chainId },
    activeExplorerTransaction: () => '',
  };
});
vi.mock('@/lib/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/http')>()),
  clientApiJson: api,
}));

function render() {
  hooks.stateIndex = 0;
  return AdminState();
}

function AdminState() {
  return useAdminWorkspace();
}

describe('goal manager workspace refresh', () => {
  beforeEach(() => {
    hooks.states.length = 0;
    vi.resetAllMocks();
    wallet.sendTransactionAsync.mockResolvedValue(`0x${'88'.repeat(32)}`);
    wallet.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    api.mockImplementation(async (path: string) => {
      if (path === '/v1/auth/me') {
        return { address: wallet.address, roles: ['SUPER_ADMIN'], chainAuthorities: ['OWNER'] };
      }
      if (path === '/v1/admin/safe/status') return activeDeployment;
      if (path === '/v1/admin/goal-managers') return { entries: [], inSync: true };
      if (path.startsWith('/v1/admin/goal-managers/')) return { mode: 'NONE', changes: [] };
      return [];
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([true, false])(
    'keeps the panel mounted while reloading after a manual policy update (enabled=%s)',
    async (enabled) => {
      await render().load();
      expect(render().state).toBe('ready');
      let finishRefresh!: () => void;
      const refresh = new Promise<void>((resolve) => {
        finishRefresh = resolve;
      });
      const initialApi = api.getMockImplementation()!;
      api.mockClear();
      api.mockImplementation(async (path: string) => {
        if (path === '/v1/admin/goal-managers') await refresh;
        return initialApi(path);
      });

      const update = render().updateGoalManager(wallet.address, enabled);
      await vi.waitFor(() =>
        expect(api).toHaveBeenCalledWith('/v1/admin/goal-managers', undefined, 'Goal managers'),
      );
      const duringRefresh = render();
      finishRefresh();
      expect(await update).toBe(true);
      expect(duringRefresh.state).toBe('ready');
      expect(duringRefresh.transactionPending).toBe(true);
      expect(render().transactionPending).toBe(false);
    },
  );

  it('keeps the panel mounted after a confirmed direct synchronization', async () => {
    await render().load();
    const states: unknown[] = [];
    hooks.states[6]!.update = (next) => {
      states.push(next);
      hooks.states[6]!.value = next;
    };
    const initialApi = api.getMockImplementation()!;
    api.mockImplementation(async (path: string) => {
      if (path.endsWith('/safe-sync/prepare')) {
        return {
          mode: 'DIRECT',
          changes: [{ address: wallet.address, enabled: true }],
          transactions: [
            {
              chainId: 84532,
              to: activeDeployment.escrowAddress,
              value: '0',
              data: '0x',
              operation: 0,
            },
          ],
        };
      }
      return initialApi(path);
    });

    await render().syncGoalManagers();
    expect(wallet.sendTransactionAsync).toHaveBeenCalledOnce();
    expect(wallet.waitForTransactionReceipt).toHaveBeenCalledOnce();
    expect(states).toEqual(['ready']);
    expect(render().transactionPending).toBe(false);
  });

  it('still removes workspace access if authorization is revoked during a refresh', async () => {
    await render().load();
    const initialApi = api.getMockImplementation()!;
    api.mockImplementation(async (path: string) => {
      if (path === '/v1/auth/me') throw new ApiError('Signed out', 401);
      return initialApi(path);
    });

    await render().updateGoalManager(wallet.address, true);
    const admin = render();
    expect(admin.state).toBe('unauthorized');
    expect(admin.principal).toBeNull();
    expect(admin.workspace).toBeNull();
    expect(admin.goalManagers).toBeNull();
    expect(admin.transactionPending).toBe(false);
  });
});
