'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  AdChargeAdminView,
  AdChargeRunView,
  AdChargeSettingsInput,
} from '@precommunity/shared';
import {
  AD_CHARGE_SETTINGS_CHANGED_EVENT,
  adChargeErrorMessage,
  adWalletRefreshIntervalMs,
} from '@precommunity/shared';
import { ApiError, clientApiJson } from '@/lib/http';
import type { StatusNoticeState } from '@/components/status-notice';

const endpoint = '/v1/admin/keyword-market/charges';

export function useKeywordMarketCharges(canManage: boolean) {
  const [view, setView] = useState<AdChargeAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [runState, setRunState] = useState<'QUEUED' | 'RUNNING' | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const actions = useRef<{
    run: () => Promise<void>;
    save: (input: AdChargeSettingsInput) => Promise<void>;
    more: () => Promise<void>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let current: AdChargeAdminView | null = null;
    let reading: Promise<void> | null = null;
    let submitting = false;
    let savingSettings = false;
    let readingMore = false;
    let polling = false;
    let jobId: string | null = null;
    let requestedAt = 0;
    let expanded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const visible = () => document.visibilityState === 'visible';

    function stopForAccess(error: unknown) {
      if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) return;
      active = false;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(refreshTimer);
      setView(null);
      setLoading(false);
      setPending(false);
      setRunState(null);
      setSaving(false);
      setLoadingMore(false);
    }

    function scheduleStatus() {
      clearTimeout(timer);
      if (!active || !jobId || !visible()) return;
      timer = setTimeout(
        () => void pollStatus(),
        Date.now() - requestedAt < 30_000 ? 2_000 : 30_000,
      );
    }

    function scheduleRefresh(dueAt = Date.now() + adWalletRefreshIntervalMs(current?.settings)) {
      clearTimeout(refreshTimer);
      if (!active || !visible()) return;
      refreshTimer = setTimeout(
        () => {
          if (Date.now() < dueAt) scheduleRefresh(dueAt);
          else void load();
        },
        Math.min(Math.max(0, dueAt - Date.now()), 2_147_483_647),
      );
    }

    function publish(next: AdChargeAdminView) {
      if (expanded && current) {
        const ids = new Set(next.history.map((batch) => batch.id));
        next = {
          ...next,
          history: [...next.history, ...current.history.filter((batch) => !ids.has(batch.id))],
          nextCursor: current.nextCursor,
        };
      }
      current = next;
      setView(next);
      const run = next.latestRun;
      if (
        !jobId &&
        run &&
        ['QUEUED', 'RUNNING'].includes(run.status) &&
        run.errorCode !== 'QUEUE_UNAVAILABLE'
      ) {
        jobId = run.jobId;
        requestedAt = Date.now();
        setPending(true);
        setRunState(run.status as 'QUEUED' | 'RUNNING');
        scheduleStatus();
      }
    }

    function load(): Promise<void> {
      if (!active || !visible()) return Promise.resolve();
      if (reading) return reading;
      reading = (async () => {
        try {
          const next = await clientApiJson<AdChargeAdminView>(
            endpoint,
            { cache: 'no-store', signal: controller.signal },
            'Charge panel',
          );
          if (active) publish(next);
        } catch (error) {
          if (!active) return;
          setNotice({
            type: 'error',
            message: error instanceof Error ? error.message : 'Charge history could not be loaded.',
          });
          stopForAccess(error);
        } finally {
          reading = null;
          if (active) setLoading(false);
          scheduleRefresh();
        }
      })();
      return reading;
    }

    async function pollStatus() {
      clearTimeout(timer);
      if (!active || !jobId || !visible() || polling) return;
      polling = true;
      try {
        const run = await clientApiJson<AdChargeRunView>(
          `${endpoint}/run/${encodeURIComponent(jobId)}`,
          { cache: 'no-store', signal: controller.signal },
          'Charge status',
        );
        if (!active) return;
        if (current) {
          const batches = new Map(run.batches.map((batch) => [batch.id, batch]));
          current = {
            ...current,
            latestRun: run,
            history: current.history.map((batch) => batches.get(batch.id) ?? batch),
          };
          setView(current);
        }
        if (['QUEUED', 'RUNNING'].includes(run.status) && run.errorCode !== 'QUEUE_UNAVAILABLE') {
          setRunState(run.status as 'QUEUED' | 'RUNNING');
          return;
        }
        jobId = null;
        setPending(false);
        setRunState(null);
        const problem = adChargeErrorMessage(run.errorCode);
        setNotice({
          type:
            run.status === 'COMPLETED' ? 'success' : run.status === 'PARTIAL' ? 'info' : 'error',
          message:
            problem ??
            (run.status === 'COMPLETED'
              ? 'Charge routine completed.'
              : run.status === 'PARTIAL'
                ? 'Some charges need attention. Check the history below.'
                : 'The charge routine could not complete.'),
        });
        if (reading) await reading;
        await load();
      } catch (error) {
        if (!active) return;
        setNotice({
          type: 'error',
          message: 'Charge status could not be checked. Waiting to reconnect.',
        });
        if (error instanceof ApiError && error.status === 404) {
          jobId = null;
          setPending(false);
          setRunState(null);
          setNotice({
            type: 'error',
            message: 'The charge run was not found. Refresh the panel before trying again.',
          });
        }
        stopForAccess(error);
      } finally {
        polling = false;
        scheduleStatus();
      }
    }

    actions.current = {
      run: async () => {
        if (!active || !canManage || submitting || jobId || current?.readiness.status !== 'READY')
          return;
        submitting = true;
        setPending(true);
        setRunState('QUEUED');
        setNotice(null);
        try {
          const result = await clientApiJson<{ jobId: string }>(
            `${endpoint}/run`,
            { method: 'POST', signal: controller.signal },
            'Charge routine',
          );
          if (!active) return;
          jobId = result.jobId;
          requestedAt = Date.now();
          scheduleStatus();
        } catch (error) {
          if (!active) return;
          setPending(false);
          setRunState(null);
          setNotice({
            type: 'error',
            message: error instanceof Error ? error.message : 'The charge could not be queued.',
          });
          stopForAccess(error);
          await load();
        } finally {
          submitting = false;
        }
      },
      save: async (input) => {
        if (!active || !canManage || savingSettings || !current?.contractAddress) return;
        savingSettings = true;
        setSaving(true);
        setNotice(null);
        try {
          await clientApiJson(
            `${endpoint}/settings`,
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(input),
              signal: controller.signal,
            },
            'Charge settings',
          );
          if (!active) return;
          setNotice({ type: 'success', message: 'Charge settings saved.' });
          if (reading) await reading;
          await load();
          if (active) document.dispatchEvent(new Event(AD_CHARGE_SETTINGS_CHANGED_EVENT));
        } catch (error) {
          if (!active) return;
          setNotice({
            type: 'error',
            message: error instanceof Error ? error.message : 'Charge settings could not be saved.',
          });
          stopForAccess(error);
        } finally {
          savingSettings = false;
          if (active) setSaving(false);
        }
      },
      more: async () => {
        if (!active || readingMore || !current?.nextCursor) return;
        readingMore = true;
        setLoadingMore(true);
        const cursor = current.nextCursor;
        try {
          const next = await clientApiJson<AdChargeAdminView>(
            `${endpoint}?cursor=${encodeURIComponent(cursor)}`,
            { cache: 'no-store', signal: controller.signal },
            'Charge history',
          );
          if (!active || !current) return;
          const ids = new Set(current.history.map((batch) => batch.id));
          current = {
            ...current,
            history: [...current.history, ...next.history.filter((batch) => !ids.has(batch.id))],
            nextCursor: next.nextCursor,
          };
          expanded = true;
          setView(current);
        } catch (error) {
          if (!active) return;
          setNotice({
            type: 'error',
            message:
              error instanceof Error ? error.message : 'More charge history could not be loaded.',
          });
          stopForAccess(error);
        } finally {
          readingMore = false;
          if (active) setLoadingMore(false);
        }
      },
    };

    function refreshVisible() {
      if (!visible()) {
        clearTimeout(timer);
        clearTimeout(refreshTimer);
        return;
      }
      void load();
      if (jobId) void pollStatus();
    }

    setView(null);
    setLoading(true);
    setPending(false);
    setRunState(null);
    setSaving(false);
    setLoadingMore(false);
    setNotice(null);
    void load();
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', refreshVisible);
      actions.current = null;
    };
  }, [canManage]);

  return {
    view,
    loading,
    pending,
    runState,
    saving,
    loadingMore,
    notice,
    run: () => actions.current?.run(),
    save: (input: AdChargeSettingsInput) => actions.current?.save(input),
    more: () => actions.current?.more(),
  };
}
