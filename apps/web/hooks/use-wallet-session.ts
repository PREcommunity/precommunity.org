'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { SiweMessage } from 'siwe';
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAccount, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import { AUTH_CHANGED_EVENT, AUTH_SIGN_IN_REQUESTED_EVENT } from '@/lib/auth-events';
import { activeChain } from '@/lib/deployment';
import { clientApiJson, clientApiRequest } from '@/lib/http';
import type { SessionPrincipal, SessionRole } from '@/lib/session-access';

interface SignInChallenge {
  nonce: string;
  domain: string;
  uri: string;
  chainId: number;
}

function useWalletSessionState() {
  const { address, chainId, isConnected, status: accountStatus } = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [sessionAddress, setSessionAddress] = useState<`0x${string}`>();
  const [sessionRoles, setSessionRoles] = useState<SessionRole[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const [canAccessSafeOwnershipAcceptance, setCanAccessSafeOwnershipAcceptance] = useState(false);
  const [error, setError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const authenticateAfterConnectRef = useRef(false);
  const authenticationInFlightRef = useRef(false);
  const connectModalWasOpenRef = useRef(false);

  const refreshSession = useCallback(async () => {
    try {
      const principal = await clientApiJson<SessionPrincipal>(
        '/v1/auth/me',
        undefined,
        'Session API',
      );
      setSessionAddress(principal.address);
      setSessionRoles(principal.roles ?? []);
      setCanAccessSafeOwnershipAcceptance(principal.canAccessSafeOwnershipAcceptance ?? false);
    } catch {
      setSessionAddress(undefined);
      setSessionRoles([]);
      setCanAccessSafeOwnershipAcceptance(false);
    } finally {
      setSessionReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    window.addEventListener(AUTH_CHANGED_EVENT, refreshSession);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, refreshSession);
  }, [refreshSession]);

  const authenticate = useCallback(
    async (wallet: `0x${string}`, currentChainId?: number) => {
      if (authenticationInFlightRef.current) return;
      authenticationInFlightRef.current = true;
      setIsAuthenticating(true);
      setError('');
      try {
        const challenge = await clientApiJson<SignInChallenge>(
          '/v1/auth/nonce',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ address: wallet }),
          },
          'Sign-in challenge',
        );
        if (challenge.chainId !== activeChain.id) {
          throw new Error('The web and API network settings do not match.');
        }
        if (currentChainId !== activeChain.id) {
          await switchChainAsync({ chainId: activeChain.id });
        }
        const message = new SiweMessage({
          domain: challenge.domain,
          address: wallet,
          statement: 'Sign in to manage your precommunity identity.',
          uri: challenge.uri,
          version: '1',
          chainId: challenge.chainId,
          nonce: challenge.nonce,
        });
        const prepared = message.prepareMessage();
        const signature = await signMessageAsync({ message: prepared });
        await clientApiRequest(
          '/v1/auth/verify',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: prepared, signature }),
          },
          'Wallet verification',
        );
        setSessionAddress(wallet);
        window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Wallet connection failed');
      } finally {
        authenticationInFlightRef.current = false;
        authenticateAfterConnectRef.current = false;
        setIsAuthenticating(false);
      }
    },
    [signMessageAsync, switchChainAsync],
  );

  useEffect(() => {
    if (authenticateAfterConnectRef.current && isConnected && address) {
      void authenticate(address, chainId);
    }
  }, [address, authenticate, chainId, isConnected]);

  useEffect(() => {
    if (connectModalWasOpenRef.current && !connectModalOpen && !isConnected) {
      authenticateAfterConnectRef.current = false;
    }
    connectModalWasOpenRef.current = connectModalOpen;
  }, [connectModalOpen, isConnected]);

  const connectAndAuthenticate = useCallback(() => {
    setError('');
    if (isConnected && address) {
      void authenticate(address, chainId);
    } else if (openConnectModal) {
      authenticateAfterConnectRef.current = true;
      openConnectModal();
    } else {
      setError('Wallet options are not ready yet.');
    }
  }, [address, authenticate, chainId, isConnected, openConnectModal]);

  useEffect(() => {
    window.addEventListener(AUTH_SIGN_IN_REQUESTED_EVENT, connectAndAuthenticate);
    return () => window.removeEventListener(AUTH_SIGN_IN_REQUESTED_EVENT, connectAndAuthenticate);
  }, [connectAndAuthenticate]);

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    setError('');
    try {
      await clientApiRequest('/v1/auth/logout', { method: 'POST' }, 'Sign-out API');
    } finally {
      authenticateAfterConnectRef.current = false;
      disconnect();
      setSessionAddress(undefined);
      setSessionRoles([]);
      setCanAccessSafeOwnershipAcceptance(false);
      setIsLoggingOut(false);
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    }
  }, [disconnect]);

  return {
    accountStatus,
    address,
    canAccessSafeOwnershipAcceptance,
    chainId,
    connectAndAuthenticate,
    connectModalOpen,
    error,
    isAuthenticating,
    isConnected,
    isLoggingOut,
    logout,
    sessionAddress,
    sessionReady,
    sessionRoles,
  };
}

type WalletSessionState = ReturnType<typeof useWalletSessionState>;

const WalletSessionContext = createContext<WalletSessionState | null>(null);

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const session = useWalletSessionState();
  return createElement(WalletSessionContext.Provider, { value: session }, children);
}

export function useWalletSession() {
  const session = useContext(WalletSessionContext);
  if (!session) {
    throw new Error('useWalletSession must be used within WalletSessionProvider');
  }
  return session;
}
