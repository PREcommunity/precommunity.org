'use client';

import { useEffect } from 'react';

export function useKeywordMarketRefresh(
  refresh: (background: boolean) => Promise<void>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };
    const timer = window.setInterval(refreshVisible, 15_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refresh, enabled]);
}
