'use client';

import type { AdCampaignView, AdRevisionView } from '@precommunity/shared';
import {
  ArrowLeft,
  ArrowUpRight,
  Ban,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AUTH_CHANGED_EVENT, AUTH_SIGN_IN_REQUESTED_EVENT } from '@/lib/auth-events';
import { createAdRevision, getMyAdCampaigns, setAdCampaignPaused } from '@/lib/keyword-market-api';
import { ApiError } from '@/lib/http';
import { ActionButton } from './action-button';
import { FormFieldError, useFormValidation } from './form-validation';
import { KeywordMarketCreativePreview } from './keyword-market-creative-preview';

function statusTone(status: AdRevisionView['status']) {
  if (status === 'APPROVED') return 'success';
  if (status === 'PENDING_REVIEW') return 'warning';
  if (status === 'REJECTED' || status === 'SUSPENDED') return 'danger';
  return 'muted';
}

function count(value: string) {
  try {
    return new Intl.NumberFormat('en').format(BigInt(value));
  } catch {
    return value;
  }
}

export function KeywordMarketCampaignDetail({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<AdCampaignView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'missing' | 'error'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [editing, setEditing] = useState(false);
  const [creative, setCreative] = useState({ headline: '', description: '', destinationUrl: '' });
  const validation = useFormValidation();

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const campaigns = await getMyAdCampaigns();
      const selected = campaigns.find((item) => item.id === campaignId) ?? null;
      setCampaign(selected);
      setState(selected ? 'ready' : 'missing');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setState('signed-out');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Campaign could not be loaded.');
      setState('error');
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
  }, [load]);

  const preview = useMemo(
    () => campaign?.activeRevision ?? campaign?.revisions[0] ?? null,
    [campaign],
  );

  function beginRevision() {
    const source = campaign?.activeRevision ?? campaign?.revisions[0];
    setCreative({
      headline: source?.headline ?? '',
      description: source?.description ?? '',
      destinationUrl: source?.destinationUrl ?? '',
    });
    setEditing(true);
  }

  async function togglePause() {
    if (!campaign) return;
    setAction('pause');
    setError('');
    try {
      await setAdCampaignPaused(campaign.id, !campaign.paused);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Campaign state could not be changed.');
    } finally {
      setAction('');
    }
  }

  async function submitRevision(event: React.FormEvent) {
    event.preventDefault();
    if (!campaign) return;
    setAction('revision');
    setError('');
    try {
      await createAdRevision(campaign.id, creative);
      setEditing(false);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Creative revision could not be submitted.',
      );
    } finally {
      setAction('');
    }
  }

  if (state !== 'ready' || !campaign) {
    return (
      <main className="keyword-market-app-shell">
        <Link className="keyword-market-back-link" href="/keyword-market/campaigns">
          <ArrowLeft size={14} /> Campaigns
        </Link>
        <div
          className={`keyword-market-access-state ${state === 'error' ? 'keyword-market-error-state' : ''}`}
        >
          {state === 'loading' ? <LoaderCircle className="animate-spin" /> : null}
          {state === 'signed-out' ? <WalletCards /> : null}
          {state === 'missing' || state === 'error' ? <CircleAlert /> : null}
          <strong>
            {state === 'loading'
              ? 'Loading campaign…'
              : state === 'signed-out'
                ? 'Sign in with the campaign wallet'
                : state === 'missing'
                  ? 'Campaign not found'
                  : 'Campaign unavailable'}
          </strong>
          {error ? <p>{error}</p> : null}
          {state === 'signed-out' ? (
            <ActionButton
              variant="primary"
              onClick={() => window.dispatchEvent(new Event(AUTH_SIGN_IN_REQUESTED_EVENT))}
            >
              Connect and sign in
            </ActionButton>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="keyword-market-app-shell">
      <header className="keyword-market-page-heading keyword-market-campaign-heading">
        <div>
          <Link className="keyword-market-back-link" href="/keyword-market/campaigns">
            <ArrowLeft size={14} /> Campaigns
          </Link>
          <span className="keyword-market-eyebrow">Keyword campaign</span>
          <h1>{campaign.keyword}</h1>
          <div className="keyword-market-heading-meta">
            <span
              className={`keyword-market-status ${campaign.paused ? 'keyword-market-status-muted' : 'keyword-market-status-success'}`}
            >
              {campaign.paused ? 'Paused' : 'Active campaign'}
            </span>
            <span>{campaign.chainStatus.replaceAll('_', ' ')}</span>
            <span>Updated {new Date(campaign.updatedAt).toLocaleDateString('en-GB')}</span>
          </div>
        </div>
        <div className="keyword-market-heading-actions">
          <ActionButton
            icon={campaign.paused ? <Play size={15} /> : <Pause size={15} />}
            onClick={() => void togglePause()}
            disabled={action === 'pause'}
          >
            {campaign.paused ? 'Resume' : 'Pause'}
          </ActionButton>
          <ActionButton variant="primary" icon={<Plus size={15} />} onClick={beginRevision}>
            New creative
          </ActionButton>
        </div>
      </header>

      {error ? <div className="keyword-market-inline-error">{error}</div> : null}

      <section className="keyword-market-campaign-overview">
        <div className="keyword-market-campaign-primary">
          <header className="keyword-market-section-heading">
            <div>
              <span className="keyword-market-eyebrow">Current result</span>
              <h2>Creative</h2>
            </div>
            {preview ? (
              <span
                className={`keyword-market-status keyword-market-status-${statusTone(preview.status)}`}
              >
                {preview.status.replaceAll('_', ' ')}
              </span>
            ) : null}
          </header>
          {preview ? (
            <KeywordMarketCreativePreview creative={preview} keyword={campaign.keyword} />
          ) : (
            <div className="keyword-market-empty-state">
              No creative revision has been submitted.
            </div>
          )}
          {campaign.pendingRevision && campaign.activeRevision ? (
            <div className="keyword-market-info-strip">
              <Clock3 size={15} /> Revision {campaign.pendingRevision.version} is pending. The
              approved revision remains live.
            </div>
          ) : null}
        </div>

        <aside className="keyword-market-stake-panel">
          <span className="keyword-market-eyebrow">Keyword position</span>
          <div className="keyword-market-rank-number">
            {campaign.position ? `#${campaign.position.rank}` : '—'}
          </div>
          <dl>
            <div>
              <dt>Your stake</dt>
              <dd>{campaign.position?.stakeRaw ?? '0'} raw</dd>
            </div>
            <div>
              <dt>Leader stake</dt>
              <dd>{campaign.leaderStakeRaw ?? '—'}</dd>
            </div>
            <div>
              <dt>Gap to lead</dt>
              <dd>{campaign.stakeNeededToLeadRaw ?? '—'}</dd>
            </div>
          </dl>
          <div
            className="keyword-market-stake-actions"
            aria-label="Stake actions awaiting contract"
          >
            <ActionButton variant="primary" disabled>
              Create stake
            </ActionButton>
            <ActionButton disabled>Increase</ActionButton>
            <ActionButton disabled>Unstake</ActionButton>
          </div>
          <p className="keyword-market-awaiting-note">
            <Ban size={14} /> AWAITING_CONTRACT — transactions disabled
          </p>
          <Link
            className="keyword-market-text-link"
            href={`/keyword-market/keywords/${encodeURIComponent(campaign.keyword)}`}
          >
            Open public ranking <ArrowUpRight size={14} />
          </Link>
        </aside>
      </section>

      {editing ? (
        <form
          className="keyword-market-revision-editor"
          onSubmit={submitRevision}
          onInvalid={validation.onInvalid}
          onInput={validation.onInput}
        >
          <header className="keyword-market-section-heading">
            <div>
              <span className="keyword-market-eyebrow">Immutable version</span>
              <h2>Submit a new creative</h2>
            </div>
            <button
              className="keyword-market-text-button"
              type="button"
              onClick={() => setEditing(false)}
            >
              Close
            </button>
          </header>
          <div className="keyword-market-revision-grid">
            <div className="keyword-market-editor-fields">
              <label className="keyword-market-field">
                <span>
                  Headline <small>{creative.headline.length}/60</small>
                </span>
                <input
                  value={creative.headline}
                  maxLength={60}
                  onChange={(event) =>
                    setCreative((value) => ({ ...value, headline: event.target.value }))
                  }
                />
              </label>
              <label className="keyword-market-field">
                <span>
                  Description <small>{creative.description.length}/160</small>
                </span>
                <textarea
                  {...validation.fieldProps('description')}
                  value={creative.description}
                  maxLength={160}
                  required
                  onChange={(event) =>
                    setCreative((value) => ({ ...value, description: event.target.value }))
                  }
                />
                <FormFieldError {...validation.errorProps('description')} />
              </label>
              <label className="keyword-market-field">
                <span>HTTPS destination</span>
                <input
                  {...validation.fieldProps('destinationUrl')}
                  type="url"
                  pattern="https://.*"
                  value={creative.destinationUrl}
                  maxLength={2048}
                  required
                  onChange={(event) =>
                    setCreative((value) => ({ ...value, destinationUrl: event.target.value }))
                  }
                />
                <FormFieldError {...validation.errorProps('destinationUrl')} />
              </label>
              <ActionButton
                type="submit"
                variant="primary"
                disabled={action === 'revision'}
                icon={
                  action === 'revision' ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : undefined
                }
              >
                {action === 'revision' ? 'Submitting…' : 'Submit for review'}
              </ActionButton>
            </div>
            <KeywordMarketCreativePreview
              creative={creative}
              keyword={campaign.keyword}
              placeholders
            />
          </div>
        </form>
      ) : null}

      <section className="keyword-market-detail-section">
        <header className="keyword-market-section-heading">
          <div>
            <span className="keyword-market-eyebrow">Performance</span>
            <h2>Resolution metrics</h2>
          </div>
        </header>
        <div className="keyword-market-metric-line">
          <div>
            <span>Last 30 days</span>
            <strong>{count(campaign.activeRevision?.last30DaysResolutions ?? '0')}</strong>
          </div>
          <div>
            <span>Lifetime</span>
            <strong>{count(campaign.activeRevision?.lifetimeResolutions ?? '0')}</strong>
          </div>
          <div>
            <span>Accounting</span>
            <strong>Non-billing</strong>
            <small>Resolver selections only</small>
          </div>
        </div>
      </section>

      <section className="keyword-market-detail-section">
        <header className="keyword-market-section-heading">
          <div>
            <span className="keyword-market-eyebrow">Moderation trail</span>
            <h2>Creative revisions</h2>
          </div>
        </header>
        <div className="keyword-market-revision-list">
          {campaign.revisions.map((revision) => (
            <div className="keyword-market-revision-row" key={revision.id}>
              <span>v{revision.version}</span>
              <div>
                <strong>{revision.headline}</strong>
                <small>{revision.displayDomain}</small>
              </div>
              <span
                className={`keyword-market-status keyword-market-status-${statusTone(revision.status)}`}
              >
                {revision.status.replaceAll('_', ' ')}
              </span>
              <span>{new Date(revision.createdAt).toLocaleDateString('en-GB')}</span>
              <span>{count(revision.lifetimeResolutions)} resolves</span>
              {revision.moderationNote ? <p>{revision.moderationNote}</p> : null}
            </div>
          ))}
        </div>
      </section>

      {campaign.position ? (
        <section className="keyword-market-detail-section">
          <header className="keyword-market-section-heading">
            <div>
              <span className="keyword-market-eyebrow">Chain evidence</span>
              <h2>Position proof</h2>
            </div>
          </header>
          <dl className="keyword-market-proof-list keyword-market-proof-list-wide">
            <div>
              <dt>Staker</dt>
              <dd>{campaign.position.stakerAddress}</dd>
            </div>
            <div>
              <dt>Amount since</dt>
              <dd>
                {campaign.position.amountSinceBlock}:{campaign.position.amountSinceLogIndex}
              </dd>
            </div>
            <div>
              <dt>Position block</dt>
              <dd>{campaign.position.positionBlock}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd>{campaign.position.positionTxHash}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </main>
  );
}
