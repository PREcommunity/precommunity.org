'use client';

import { useEffect, useRef, useState } from 'react';
import type { PreUsdPriceAdminView, PreUsdPriceRefreshStatus } from '@precommunity/shared';
import { ApiError, clientApiJson } from '@/lib/http';
import type { StatusNoticeState } from '@/components/status-notice';

export function usePreUsdPrice(canRefresh: boolean) {
  const [view, setView] = useState<PreUsdPriceAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [refreshState, setRefreshState] = useState<'QUEUED' | 'RUNNING' | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const requestRefresh = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let active = true;
    let currentView: PreUsdPriceAdminView | null = null;
    let priceRequest: Promise<boolean> | null = null;
    let statusPending = false;
    let submitting = false;
    let jobId: string | null = null;
    let requestedAt = 0;
    let retryAt = 0;
    let statusTimer: ReturnType<typeof setTimeout> | undefined;
    let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const visible = () => document.visibilityState === 'visible';

    function checkAccess(error: unknown) {
      if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) return;
      active = false;
      controller.abort();
      clearTimeout(statusTimer);
      setView(null);
      setLoading(false);
      setPending(false);
      setRefreshState(null);
    }

    function loadPrice(): Promise<boolean> {
      if (!active || !visible()) return Promise.resolve(false);
      if (priceRequest) return priceRequest;
      priceRequest = (async () => {
        try {
          const next = await clientApiJson<PreUsdPriceAdminView>(
            '/v1/admin/pre-usd-price',
            { cache: 'no-store', signal: controller.signal },
            'PRE price',
          );
          if (!active) return false;
          currentView = next;
          setView(next);
          return true;
        } catch (error) {
          if (!active) return false;
          setNotice({
            type: 'error',
            message: error instanceof Error ? error.message : 'The PRE price could not be loaded.',
          });
          checkAccess(error);
          return false;
        } finally {
          priceRequest = null;
          if (active) setLoading(false);
        }
      })();
      return priceRequest;
    }

    function scheduleStatus() {
      clearTimeout(statusTimer);
      if (!active || !jobId || !visible()) return;
      statusTimer = setTimeout(
        () => void pollStatus(),
        Date.now() - requestedAt < 30_000 ? 2_000 : 30_000,
      );
    }

    async function pollStatus() {
      clearTimeout(statusTimer);
      if (!active || !jobId || !visible() || statusPending) return;
      statusPending = true;
      try {
        const status = await clientApiJson<PreUsdPriceRefreshStatus>(
          `/v1/admin/pre-usd-price/refresh/${encodeURIComponent(jobId)}`,
          { cache: 'no-store', signal: controller.signal },
          'Price refresh status',
        );
        if (!active) return;
        if (status.status === 'QUEUED' || status.status === 'RUNNING') {
          setRefreshState(status.status);
          return;
        }
        jobId = null;
        setPending(false);
        setRefreshState(null);
        if (status.status === 'FAILED') {
          setNotice({
            type: 'error',
            message: 'The price could not be refreshed. Try again later.',
          });
          return;
        }
        if (!status.result) {
          setNotice({
            type: 'error',
            message: 'The refresh finished without a price result. Please try again.',
          });
          return;
        }
        if (priceRequest) await priceRequest;
        const reloaded = await loadPrice();
        if (!active) return;
        if (status.result?.outcome === 'COOLDOWN') {
          retryAt = status.result.retryAt ? Date.parse(status.result.retryAt) : Date.now() + 60_000;
          setCooldown(retryAt > Date.now());
          cooldownTimer = setTimeout(
            () => {
              if (active) setCooldown(false);
            },
            Math.max(0, retryAt - Date.now()),
          );
          setNotice({
            type: 'info',
            message: `A price check was attempted recently. Try again after ${new Date(retryAt).toLocaleTimeString()}.`,
          });
        } else if (reloaded) {
          setNotice({
            type: status.result?.outcome === 'UPDATED' ? 'success' : 'info',
            message:
              status.result?.outcome === 'UPDATED'
                ? 'CoinGecko quote updated. Contract publication is handled separately.'
                : 'CoinGecko has not published a newer quote.',
          });
        }
      } catch (error) {
        if (!active) return;
        setNotice({
          type: 'error',
          message: 'Refresh status could not be checked. Waiting to reconnect.',
        });
        if (error instanceof ApiError && error.status === 404) {
          jobId = null;
          setPending(false);
          setRefreshState(null);
          setNotice({
            type: 'error',
            message: 'The refresh task is no longer available. Please try again.',
          });
        }
        checkAccess(error);
      } finally {
        statusPending = false;
        scheduleStatus();
      }
    }

    requestRefresh.current = async () => {
      if (
        !active ||
        !canRefresh ||
        !currentView?.collectorEnabled ||
        submitting ||
        jobId ||
        Date.now() < retryAt
      )
        return;
      submitting = true;
      setPending(true);
      setRefreshState('QUEUED');
      setNotice(null);
      try {
        const result = await clientApiJson<{ jobId: string }>(
          '/v1/admin/pre-usd-price/refresh',
          { method: 'POST', signal: controller.signal },
          'Price refresh',
        );
        if (!active) return;
        jobId = result.jobId;
        requestedAt = Date.now();
        scheduleStatus();
      } catch (error) {
        if (!active) return;
        setPending(false);
        setRefreshState(null);
        setNotice({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'The price refresh could not be queued.',
        });
        checkAccess(error);
      } finally {
        submitting = false;
      }
    };

    function refreshVisible() {
      if (!visible()) {
        clearTimeout(statusTimer);
        return;
      }
      void loadPrice();
      if (jobId) void pollStatus();
    }

    setLoading(true);
    setPending(false);
    setRefreshState(null);
    setCooldown(false);
    void loadPrice();
    const priceTimer = setInterval(() => void loadPrice(), 60_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      active = false;
      controller.abort();
      clearInterval(priceTimer);
      clearTimeout(statusTimer);
      clearTimeout(cooldownTimer);
      document.removeEventListener('visibilitychange', refreshVisible);
      requestRefresh.current = null;
    };
  }, [canRefresh]);

  return {
    view,
    loading,
    pending,
    refreshState,
    cooldown,
    notice,
    refresh: () => requestRefresh.current?.(),
  };
}
