'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { darkTheme, lightTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { usePathname } from 'next/navigation';
import { WagmiProvider } from 'wagmi';
import { activeChain } from '@/lib/deployment';
import { queryClient, wagmiConfig } from '@/lib/web3';
import { WalletSessionProvider } from '@/hooks/use-wallet-session';
import { WalletConnectionRestorer } from './wallet-connection-restorer';
import { ThemeProvider, useTheme } from './theme-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const appName =
    pathname === '/keyword-market' || pathname.startsWith('/keyword-market/')
      ? 'PRE Keyword Market'
      : 'precommunity';
  return (
    <ThemeProvider>
      <WalletProviders appName={appName}>{children}</WalletProviders>
    </ThemeProvider>
  );
}

function WalletProviders({ children, appName }: { children: React.ReactNode; appName: string }) {
  const { resolvedTheme } = useTheme();
  const theme = (resolvedTheme === 'dark' ? darkTheme : lightTheme)({
    accentColor: '#2d8eff',
    accentColorForeground: '#091c33',
    borderRadius: 'small',
    fontStack: 'system',
    overlayBlur: 'small',
  });

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <WalletConnectionRestorer />
        <RainbowKitProvider
          initialChain={activeChain}
          locale="en-US"
          modalSize="compact"
          showRecentTransactions
          appInfo={{ appName }}
          theme={theme}
        >
          <WalletSessionProvider>{children}</WalletSessionProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
