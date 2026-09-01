'use client';

import { useState } from 'react';
import { useApplicationFeatures } from '@/hooks/use-application-features';
import { APPLICATION_FEATURES_CHANGED_EVENT } from '@/lib/application-features';
import { clientApiJson } from '@/lib/http';
import { ConfirmationDialog } from './confirmation-dialog';
import { StatusNotice, type StatusNoticeState } from './status-notice';

export function KeywordMarketFeaturePanel({ canManage }: { canManage: boolean }) {
  const { features, loading, refresh } = useApplicationFeatures();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const enabled = features.keywordMarketEnabled;

  async function update() {
    setPending(true);
    setNotice(null);
    try {
      const next = await clientApiJson<{ keywordMarketEnabled: boolean }>(
        '/v1/admin/features/keyword-market',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: !enabled }),
        },
        'Keyword Market setting',
      );
      setNotice({
        type: 'success',
        message: `Keyword Market ${next.keywordMarketEnabled ? 'enabled' : 'disabled'}.`,
      });
      window.dispatchEvent(new Event(APPLICATION_FEATURES_CHANGED_EVENT));
      await refresh();
      setConfirming(false);
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Keyword Market setting could not be changed.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mb-[34px] border-y border-line py-5">
      <header className="flex items-center justify-between gap-5 max-sm:flex-col max-sm:items-stretch">
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Application features
          </span>
          <h2 className="my-1 text-[25px]">Keyword Marketplace</h2>
          <p className="m-0 max-w-[720px] text-sm text-muted">
            Controls the market pages, API endpoints, indexing, metrics and data retention jobs.
          </p>
        </div>
        <span className="flex items-center gap-2 max-sm:justify-between">
          <button
            className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-navy px-2.5 text-[10px] font-bold transition-colors duration-150 hover:border-blue hover:bg-blue-soft disabled:cursor-not-allowed disabled:opacity-55 ${enabled ? 'bg-navy text-white hover:text-navy dark:hover:text-white' : 'bg-white'}`}
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={loading || pending || !canManage}
            title={canManage ? undefined : 'Only SUPER_ADMIN can change this setting'}
            onClick={() => setConfirming(true)}
          >
            <i className={`size-2 rounded-full ${enabled ? 'bg-success' : 'bg-muted'}`} />
            <span>{enabled ? 'Market visible' : 'Market hidden'}</span>
          </button>
        </span>
      </header>
      {!canManage ? (
        <p className="mt-3 mb-0 text-xs text-muted">Only SUPER_ADMIN can change this setting.</p>
      ) : null}
      <StatusNotice notice={notice} />
      <ConfirmationDialog
        open={confirming}
        title={`${enabled ? 'Disable' : 'Enable'} Keyword Marketplace?`}
        description={
          enabled
            ? 'The market will disappear and its API and background jobs will stop. Existing data will be preserved.'
            : 'The market pages, API endpoints and background jobs will become available.'
        }
        confirmLabel={enabled ? 'Disable market' : 'Enable market'}
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void update()}
      />
    </section>
  );
}
