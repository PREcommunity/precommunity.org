'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useApplicationFeatures } from '@/hooks/use-application-features';
import {
  APPLICATION_FEATURES_CHANGED_EVENT,
  type ApplicationFeatures,
} from '@/lib/application-features';
import { clientApiJson } from '@/lib/http';
import { ConfirmationDialog } from './confirmation-dialog';
import { StatusNotice, type StatusNoticeState } from './status-notice';

export function KeywordMarketFeaturePanel({
  canManage,
  canModerate,
}: {
  canManage: boolean;
  canModerate: boolean;
}) {
  const { features, loading, refresh } = useApplicationFeatures();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<'market' | 'review' | null>(null);
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const enabled = features.keywordMarketEnabled;
  const requireReview = features.keywordMarketRequireReview;
  const confirmingReview = confirming === 'review';

  async function update() {
    if (!canManage || !confirming || pending) return;
    setPending(true);
    setNotice(null);
    try {
      const next = await clientApiJson<ApplicationFeatures>(
        confirmingReview
          ? '/v1/admin/features/keyword-market/review'
          : '/v1/admin/features/keyword-market',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            confirmingReview ? { requireReview: !requireReview } : { enabled: !enabled },
          ),
        },
        'Keyword Market setting',
      );
      setNotice({
        type: 'success',
        message: confirmingReview
          ? `Keyword Market review requirement ${next.keywordMarketRequireReview ? 'enabled' : 'disabled'}.`
          : `Keyword Market ${next.keywordMarketEnabled ? 'enabled' : 'disabled'}.`,
      });
      window.dispatchEvent(new Event(APPLICATION_FEATURES_CHANGED_EVENT));
      await refresh();
      setConfirming(null);
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
        <span className="flex flex-wrap items-center gap-2 max-sm:justify-between">
          {canModerate && enabled ? (
            <Link
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-navy bg-white px-2.5 text-[10px] font-bold text-navy transition-colors hover:border-blue hover:bg-blue-soft"
              href="/keyword-market/admin"
            >
              Open ad moderation <ExternalLink size={13} />
            </Link>
          ) : null}
          <button
            className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-navy px-2.5 text-[10px] font-bold transition-colors duration-150 hover:border-blue hover:bg-blue-soft disabled:cursor-not-allowed disabled:opacity-55 ${enabled ? 'bg-navy text-white hover:text-navy dark:hover:text-white' : 'bg-white'}`}
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={loading || pending || !canManage}
            title={canManage ? undefined : 'Only SUPER_ADMIN can change this setting'}
            onClick={() => setConfirming('market')}
          >
            <i className={`size-2 rounded-full ${enabled ? 'bg-success' : 'bg-muted'}`} />
            <span>{enabled ? 'Market visible' : 'Market hidden'}</span>
          </button>
          <button
            className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-navy px-2.5 text-[10px] font-bold transition-colors duration-150 hover:border-blue hover:bg-blue-soft disabled:cursor-not-allowed disabled:opacity-55 ${requireReview ? 'bg-navy text-white hover:text-navy dark:hover:text-white' : 'bg-white'}`}
            type="button"
            role="switch"
            aria-label="Require review"
            aria-checked={requireReview}
            disabled={loading || pending || !canManage}
            title={canManage ? undefined : 'Only SUPER_ADMIN can change this setting'}
            onClick={() => setConfirming('review')}
          >
            <i className={`size-2 rounded-full ${requireReview ? 'bg-success' : 'bg-muted'}`} />
            <span>Require review {requireReview ? 'on' : 'off'}</span>
          </button>
        </span>
      </header>
      <p className="mt-3 mb-0 max-w-[720px] text-xs text-muted">
        {requireReview
          ? 'New campaigns and creative revisions wait for moderator approval.'
          : 'New campaigns and creative revisions are automatically approved and published when eligible.'}{' '}
        Existing pending reviews stay in moderation.
      </p>
      {!canManage ? (
        <p className="mt-3 mb-0 text-xs text-muted">Only SUPER_ADMIN can change these settings.</p>
      ) : null}
      <StatusNotice notice={notice} />
      <ConfirmationDialog
        open={confirming !== null}
        title={
          confirmingReview
            ? requireReview
              ? 'Turn off required review?'
              : 'Require review for new submissions?'
            : `${enabled ? 'Disable' : 'Enable'} Keyword Marketplace?`
        }
        description={
          confirmingReview
            ? requireReview
              ? 'New campaigns and creative revisions will be automatically approved and published when eligible. Existing pending reviews will stay in moderation.'
              : 'New campaigns and creative revisions will wait for moderator approval before publication. Existing submissions will keep their current status.'
            : enabled
              ? 'The market will disappear and its API and background jobs will stop. Existing data will be preserved.'
              : 'The market pages, API endpoints and background jobs will become available.'
        }
        confirmLabel={
          confirmingReview
            ? requireReview
              ? 'Turn off review'
              : 'Require review'
            : enabled
              ? 'Disable market'
              : 'Enable market'
        }
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void update()}
      />
    </section>
  );
}
