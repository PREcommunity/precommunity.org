import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletSessionProvider } from './use-wallet-session';

const hooks = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown; update: (next: unknown) => void }>,
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<() => (() => void) | undefined>,
  stateIndex: 0,
  refIndex: 0,
}));
const mocks = vi.hoisted(() => ({
  connectors: [
    { id: 'injected', uid: 'first' },
    { id: 'walletConnect', uid: 'second' },
  ],
  disconnectAsync: vi.fn(),
  removeItem: vi.fn(),
  apiJson: vi.fn(),
  apiRequest: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: () => (() => void) | undefined) => hooks.effects.push(callback),
  useRef: (current: unknown) => (hooks.refs[hooks.refIndex++] ??= { current }),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    const cell = (hooks.states[index] ??= {
      value: initial,
      update: (next: unknown) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      },
    });
    return [cell.value, cell.update];
  },
}));
vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1111111111111111111111111111111111111111',
    chainId: 84532,
    isConnected: true,
    status: 'connected',
  }),
  useConfig: () => ({ storage: { removeItem: mocks.removeItem } }),
  useDisconnect: () => ({
    connectors: mocks.connectors,
    disconnectAsync: mocks.disconnectAsync,
    isPending: false,
  }),
  useSignMessage: () => ({}),
  useSwitchChain: () => ({}),
}));
vi.mock('@/lib/deployment', () => ({ activeChain: { id: 84532 } }));
vi.mock('@/lib/http', () => ({
  clientApiJson: mocks.apiJson,
  clientApiRequest: mocks.apiRequest,
}));

function renderSession() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects.length = 0;
  return WalletSessionProvider({ children: null }).props.value!;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('wallet disconnection', () => {
  let cleanups: Array<() => void> = [];

  beforeEach(() => {
    hooks.states.length = 0;
    hooks.refs.length = 0;
    vi.resetAllMocks();
    vi.stubGlobal('window', new EventTarget());
    mocks.disconnectAsync.mockResolvedValue(undefined);
    mocks.removeItem.mockResolvedValue(undefined);
    mocks.apiJson.mockResolvedValue({
      address: '0x1111111111111111111111111111111111111111',
      roles: ['SUPER_ADMIN'],
      canAccessSafeOwnershipAcceptance: true,
    });
    mocks.apiRequest.mockImplementation(async () => {
      mocks.apiJson.mockRejectedValue(new Error('Signed out'));
    });
  });

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    vi.unstubAllGlobals();
  });

  async function mount() {
    renderSession();
    cleanups = hooks.effects.map((effect) => effect()).filter((cleanup) => cleanup !== undefined);
    await vi.waitFor(() => expect(hooks.states[2]!.value).toBe(true));
    return renderSession();
  }

  it('awaits every active connector before signing out and clearing the session', async () => {
    const session = await mount();
    const first = deferred();
    const second = deferred();
    const complete = vi.fn();
    mocks.disconnectAsync
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const loggingOut = session.logout().then(complete);
    expect(renderSession().isLoggingOut).toBe(true);
    await vi.waitFor(() => expect(mocks.disconnectAsync).toHaveBeenCalledTimes(1));
    expect(mocks.disconnectAsync).toHaveBeenCalledWith({ connector: mocks.connectors[0] });
    expect(mocks.apiRequest).not.toHaveBeenCalled();

    first.resolve();
    await vi.waitFor(() => expect(mocks.disconnectAsync).toHaveBeenCalledTimes(2));
    expect(mocks.disconnectAsync).toHaveBeenLastCalledWith({ connector: mocks.connectors[1] });
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();

    second.resolve();
    await loggingOut;
    expect(mocks.removeItem).toHaveBeenCalledWith('recentConnectorId');
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/v1/auth/logout',
      { method: 'POST' },
      'Sign-out API',
    );
    const signedOut = renderSession();
    expect(signedOut.sessionAddress).toBeUndefined();
    expect(signedOut.sessionRoles).toEqual([]);
    expect(signedOut.canAccessSafeOwnershipAcceptance).toBe(false);
    expect(signedOut.isLoggingOut).toBe(false);
  });

  it('disconnects without signing out the API session when only Disconnect is requested', async () => {
    const session = await mount();
    await session.disconnectWallet();
    expect(mocks.disconnectAsync).toHaveBeenCalledTimes(2);
    expect(mocks.removeItem).toHaveBeenCalledWith('recentConnectorId');
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(renderSession().sessionAddress).toBe(session.sessionAddress);
    expect(renderSession().sessionRoles).toEqual(['SUPER_ADMIN']);
  });

  it('shows a failure but still disconnects the other wallet and signs out the API session', async () => {
    const session = await mount();
    mocks.disconnectAsync.mockRejectedValueOnce(new Error('Wallet refused to disconnect'));
    await session.logout();
    expect(mocks.disconnectAsync).toHaveBeenCalledTimes(2);
    expect(mocks.disconnectAsync).toHaveBeenLastCalledWith({ connector: mocks.connectors[1] });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/v1/auth/logout',
      { method: 'POST' },
      'Sign-out API',
    );
    const signedOut = renderSession();
    expect(signedOut.error).toBe('Wallet refused to disconnect');
    expect(signedOut.sessionAddress).toBeUndefined();
    expect(signedOut.sessionRoles).toEqual([]);
    expect(signedOut.isLoggingOut).toBe(false);
  });
});
