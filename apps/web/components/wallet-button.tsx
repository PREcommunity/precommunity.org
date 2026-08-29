'use client';

import { LogOut, RefreshCw, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { shortAddress } from '@/lib/format';
import { HEADER_OVERLAY_EVENT, openHeaderOverlay } from './header-overlay';

export function WalletButton({
  profileHref = '/profile',
  profileLabel = 'Edit community profile',
}: {
  profileHref?: string;
  profileLabel?: string;
} = {}) {
  const session = useWalletSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const walletActionRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function closeMenuOnOutsideClick(event: PointerEvent) {
      if (!walletActionRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }

    document.addEventListener('pointerdown', closeMenuOnOutsideClick);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideClick);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    const close = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== 'profile') setMenuOpen(false);
    };
    window.addEventListener(HEADER_OVERLAY_EVENT, close);
    return () => window.removeEventListener(HEADER_OVERLAY_EVENT, close);
  }, []);

  if (session.sessionAddress) {
    const displayAddress = shortAddress(session.sessionAddress);
    const walletMatchesSession =
      session.isConnected &&
      session.address?.toLowerCase() === session.sessionAddress.toLowerCase();
    const walletIsRestoring =
      session.accountStatus === 'connecting' || session.accountStatus === 'reconnecting';
    const connectionState = walletIsRestoring
      ? 'reconnecting'
      : walletMatchesSession
        ? 'connected'
        : 'disconnected';
    const connectionLabel =
      connectionState === 'reconnecting'
        ? 'Restoring wallet connection'
        : connectionState === 'connected'
          ? 'Wallet connected'
          : session.isConnected
            ? 'A different wallet is connected'
            : 'Wallet disconnected';

    return (
      <div className="relative flex items-center justify-self-end" ref={walletActionRef}>
        <button
          ref={menuButtonRef}
          type="button"
          className={`relative grid size-9 cursor-pointer place-items-center rounded-full border border-navy bg-transparent text-navy transition-colors duration-150 hover:border-blue hover:bg-blue-soft aria-expanded:border-blue aria-expanded:bg-blue-soft dark:border-current after:absolute after:-right-px after:-bottom-px after:size-2 after:rounded-full after:border-2 after:border-paper ${connectionState === 'connected' ? 'after:bg-success' : connectionState === 'disconnected' ? 'after:bg-warning' : 'after:bg-[#7d8fa4]'} max-sm:size-[34px]`}
          aria-label={`Signed-in session ${displayAddress}. ${connectionLabel}. Open account menu`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="wallet-session-menu"
          onClick={() => {
            const next = !menuOpen;
            setMenuOpen(next);
            if (next) openHeaderOverlay('profile');
          }}
        >
          <UserRound size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div
            className="absolute top-[calc(100%+10px)] right-0 z-80 w-[232px] origin-top-right overflow-hidden border border-navy bg-paper shadow-[0_18px_42px_rgba(9,28,51,.16)] [animation:account-menu-in_.18s_cubic-bezier(.16,1,.3,1)_both] max-sm:w-[min(232px,calc(100vw-32px))]"
            id="wallet-session-menu"
            role="menu"
          >
            <div className="flex flex-col gap-1.5 border-b border-line px-4 py-3.5">
              <span className="text-[9px] font-bold tracking-[.1em] text-muted uppercase">
                Signed-in session
              </span>
              <strong className="font-mono text-xs font-normal">{displayAddress}</strong>
            </div>
            <div
              className={`flex items-center gap-2 border-b border-line px-4 py-2.5 text-[11px] text-muted before:size-[7px] before:rounded-full ${connectionState === 'connected' ? 'before:bg-success' : connectionState === 'disconnected' ? 'before:bg-warning' : 'before:bg-[#7d8fa4]'}`}
            >
              <span>{connectionLabel}</span>
            </div>
            <Link
              href={profileHref}
              role="menuitem"
              className="flex min-h-[42px] w-full items-center gap-2 border-0 bg-transparent px-4 text-xs font-bold text-navy hover:bg-navy hover:text-white"
              onClick={() => setMenuOpen(false)}
            >
              <UserRound size={15} aria-hidden="true" />
              {profileLabel}
            </Link>
            {!walletMatchesSession && !walletIsRestoring ? (
              <button
                type="button"
                role="menuitem"
                className="flex min-h-[42px] w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-4 text-xs font-bold text-navy hover:bg-navy hover:text-white disabled:cursor-wait disabled:opacity-60"
                onClick={session.connectAndAuthenticate}
                disabled={session.connectModalOpen || session.isAuthenticating}
              >
                <RefreshCw size={15} aria-hidden="true" />
                {session.isConnected ? 'Use connected wallet' : 'Reconnect wallet'}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="flex min-h-[42px] w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-4 text-xs font-bold text-navy hover:bg-navy hover:text-white disabled:cursor-wait disabled:opacity-60"
              onClick={() => {
                setMenuOpen(false);
                void session.logout();
              }}
              disabled={session.isLoggingOut}
            >
              <LogOut size={15} aria-hidden="true" />
              {session.isLoggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="h-[38px] min-w-[124px] cursor-pointer rounded-md border border-navy bg-navy px-3.5 text-xs font-bold text-white hover:border-blue hover:bg-blue hover:text-navy disabled:cursor-wait disabled:opacity-70 dark:border-ink dark:bg-surface dark:text-ink dark:hover:border-blue dark:hover:bg-blue-soft dark:hover:text-ink max-sm:h-9 max-sm:min-w-[108px] max-sm:px-2.5"
        onClick={session.connectAndAuthenticate}
        disabled={session.connectModalOpen || session.isAuthenticating}
      >
        {session.connectModalOpen
          ? 'Choose wallet…'
          : session.isAuthenticating
            ? 'Signing in…'
            : session.isConnected
              ? 'Sign in'
              : 'Connect wallet'}
      </button>
      {session.error ? (
        <span
          className="absolute top-[calc(100%+10px)] right-0 w-[260px] bg-navy px-3 py-2.5 text-xs text-white"
          role="alert"
        >
          {session.error}
        </span>
      ) : null}
    </div>
  );
}
