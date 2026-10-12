import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnect } from 'wagmi/actions';
import { WalletConnectionRestorer } from './wallet-connection-restorer';

const mocks = vi.hoisted(() => ({
  effect: undefined as (() => (() => void) | undefined) | undefined,
  recentConnectorId: 'injected' as string | undefined,
  reconnectAsync: vi.fn(),
  config: {
    connectors: [{ id: 'injected', uid: 'wallet' }],
    storage: { getItem: vi.fn() },
    state: { current: null as string | null, status: 'disconnected' },
    setState: vi.fn(),
  },
}));

vi.mock('react', () => ({
  useEffect: (callback: () => (() => void) | undefined) => {
    mocks.effect = callback;
  },
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('wagmi', () => ({ useReconnect: () => ({ reconnectAsync: mocks.reconnectAsync }) }));
vi.mock('wagmi/actions', () => ({ disconnect: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/web3', () => ({ wagmiConfig: mocks.config }));

describe('wallet restoration after explicit disconnection', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    mocks.recentConnectorId = 'injected';
    mocks.config.state = { current: null, status: 'disconnected' };
    mocks.config.storage.getItem.mockImplementation(async () => mocks.recentConnectorId);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function startRestoration() {
    WalletConnectionRestorer();
    cleanup = mocks.effect!();
    await vi.advanceTimersByTimeAsync(0);
  }

  it('disconnects a late restored wallet after logout removed its restore preference', async () => {
    let completeReconnect!: (connections: unknown[]) => void;
    mocks.reconnectAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeReconnect = resolve;
        }),
    );
    await startRestoration();
    expect(mocks.reconnectAsync).toHaveBeenCalledOnce();

    mocks.recentConnectorId = undefined;
    mocks.config.state = { current: 'wallet', status: 'connecting' };
    completeReconnect([{ connector: mocks.config.connectors[0] }]);
    await vi.advanceTimersByTimeAsync(0);

    expect(disconnect).toHaveBeenCalledWith(mocks.config, {
      connector: mocks.config.connectors[0],
    });
    expect(mocks.config.setState).not.toHaveBeenCalled();
  });

  it('does not restore a wallet on reload after its preference was removed', async () => {
    mocks.recentConnectorId = undefined;
    await startRestoration();
    expect(mocks.reconnectAsync).not.toHaveBeenCalled();
  });

  it('keeps restoring the last wallet when it was not explicitly disconnected', async () => {
    mocks.reconnectAsync.mockImplementation(async () => {
      mocks.config.state = { current: 'wallet', status: 'connecting' };
      return [{ connector: mocks.config.connectors[0] }];
    });
    await startRestoration();
    expect(mocks.config.setState).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
