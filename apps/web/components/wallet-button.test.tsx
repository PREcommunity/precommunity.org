import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletButton } from './wallet-button';

const session = vi.hoisted(() => ({
  sessionAddress: undefined as string | undefined,
  address: '0x1111111111111111111111111111111111111111',
  isConnected: true,
  connectModalOpen: false,
  isAuthenticating: false,
  isLoggingOut: false,
  isDisconnecting: false,
  error: '',
  connectAndAuthenticate: vi.fn(),
  disconnectWallet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock('@/hooks/use-wallet-session', () => ({ useWalletSession: () => session }));

type ButtonProps = {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
};

function buttons(node: ReactNode): ReactElement<ButtonProps>[] {
  if (!isValidElement<ButtonProps>(node)) return [];
  return [
    ...(node.type === 'button' ? [node] : []),
    ...Children.toArray(node.props.children).flatMap(buttons),
  ];
}

describe('wallet sign-in controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(session, {
      sessionAddress: undefined,
      isConnected: true,
      connectModalOpen: false,
      isAuthenticating: false,
      isLoggingOut: false,
      isDisconnecting: false,
      error: '',
    });
  });

  it('offers Sign in and Disconnect when a wallet is connected without a session', () => {
    const tree = WalletButton();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Sign in');
    expect(html).toContain('Disconnect');
    expect(buttons(tree)).toHaveLength(2);
  });

  it('offers only Connect wallet when no wallet is connected', () => {
    session.isConnected = false;
    const tree = WalletButton();
    expect(renderToStaticMarkup(tree)).toContain('Connect wallet');
    expect(renderToStaticMarkup(tree)).not.toContain('Disconnect');
    expect(buttons(tree)).toHaveLength(1);
  });

  it('disconnects the wallet through the shared session action', async () => {
    const disconnectButton = buttons(WalletButton()).find((button) =>
      renderToStaticMarkup(button).includes('Disconnect'),
    );
    expect(disconnectButton).toBeDefined();
    await disconnectButton!.props.onClick!();
    expect(session.disconnectWallet).toHaveBeenCalledOnce();
    expect(session.connectAndAuthenticate).not.toHaveBeenCalled();
  });

  it('disables both actions while disconnection is in progress', () => {
    session.isDisconnecting = true;
    const actions = buttons(WalletButton());
    expect(actions).toHaveLength(2);
    expect(actions.every((button) => button.props.disabled)).toBe(true);
  });
});
