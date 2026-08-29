'use client';

import { useEffect, useRef } from 'react';
import { useReconnect } from 'wagmi';
import { wagmiConfig } from '@/lib/web3';

const CONNECTOR_DISCOVERY_TIMEOUT_MS = 1_000;
const RECONNECT_TIMEOUT_MS = 4_000;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function finishTimedOutReconnect() {
  const state = wagmiConfig.state;
  if (state.status !== 'connecting' && state.status !== 'reconnecting') return;

  const hasActiveConnection = Boolean(state.current && state.connections.has(state.current));
  wagmiConfig.setState((current) => ({
    ...current,
    current: hasActiveConnection ? current.current : null,
    status: hasActiveConnection ? 'connected' : 'disconnected',
  }));
}

export function WalletConnectionRestorer() {
  const { reconnectAsync } = useReconnect();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    let active = true;
    let reconnectTimeout: number | undefined;

    async function restoreRecentConnector() {
      const recentConnectorId = await wagmiConfig.storage?.getItem('recentConnectorId');
      if (!active || !recentConnectorId) return;

      const discoveryDeadline = Date.now() + CONNECTOR_DISCOVERY_TIMEOUT_MS;
      let connector = wagmiConfig.connectors.find(
        (candidate) => candidate.id === recentConnectorId,
      );
      while (!connector && active && Date.now() < discoveryDeadline) {
        await delay(25);
        connector = wagmiConfig.connectors.find((candidate) => candidate.id === recentConnectorId);
      }
      if (!active || !connector) return;

      reconnectTimeout = window.setTimeout(finishTimedOutReconnect, RECONNECT_TIMEOUT_MS);
      try {
        const connections = await reconnectAsync({ connectors: [connector] });
        if (!active || connections.length === 0 || !wagmiConfig.state.current) return;
        // A connector can resolve after our UI timeout. Make that late success
        // authoritative instead of leaving Wagmi with a connection marked idle.
        wagmiConfig.setState((current) => ({
          ...current,
          status: 'connected',
        }));
      } catch {
        if (active) finishTimedOutReconnect();
      } finally {
        if (reconnectTimeout !== undefined) window.clearTimeout(reconnectTimeout);
      }
    }

    // Wagmi hydrates persisted state in its own mount effect. Yield once so
    // injected EIP-6963 connectors can be registered before selecting the
    // connector that was actually used last time.
    const start = window.setTimeout(() => void restoreRecentConnector(), 0);
    return () => {
      active = false;
      window.clearTimeout(start);
      if (reconnectTimeout !== undefined) window.clearTimeout(reconnectTimeout);
    };
  }, [reconnectAsync]);

  return null;
}
