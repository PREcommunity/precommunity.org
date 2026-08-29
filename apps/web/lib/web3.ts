'use client';

import { QueryClient } from '@tanstack/react-query';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import {
  base as baseWallet,
  injectedWallet,
  ledgerWallet,
  metaMaskWallet,
  phantomWallet,
  rabbyWallet,
  rainbowWallet,
  safeWallet,
  trustWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { activeChain, activeRpcUrl } from './deployment';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
const wallets = projectId
  ? [
      {
        groupName: 'Recommended',
        wallets: [rainbowWallet, metaMaskWallet, baseWallet, rabbyWallet],
      },
      {
        groupName: 'More wallets',
        wallets: [
          trustWallet,
          ledgerWallet,
          phantomWallet,
          safeWallet,
          walletConnectWallet,
          injectedWallet,
        ],
      },
    ]
  : [
      {
        groupName: 'Available wallets',
        wallets: [baseWallet, safeWallet, injectedWallet],
      },
    ];

export const wagmiConfig = getDefaultConfig({
  appName: 'precommunity',
  appDescription: 'Community funding with a public, chain-verified ledger.',
  projectId: projectId ?? 'walletconnect-disabled',
  chains: [activeChain],
  wallets,
  transports: { [activeChain.id]: http(activeRpcUrl) },
  ssr: true,
});

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});
