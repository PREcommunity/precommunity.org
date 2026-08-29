'use client';

import type { AdCampaignView, AdCreativeStatusCode } from '@precommunity/shared';
import { ArrowRight, CircleAlert, LoaderCircle, Plus, RefreshCw, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AUTH_CHANGED_EVENT, AUTH_SIGN_IN_REQUESTED_EVENT } from '@/lib/auth-events';
import { getMyAdCampaigns } from '@/lib/keyword-market-api';
import { ApiError } from '@/lib/http';
import { ActionButton } from './action-button';

const statusLabel: Record<AdCreativeStatusCode, string> = {
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  SUPERSEDED: 'Superseded',
};

function campaignStatus(campaign: AdCampaignView) {
  if (campaign.paused) return { label: 'Paused', tone: 'muted' };
  if (campaign.pendingRevision) return { label: 'Pending review', tone: 'warning' };
  if (campaign.activeRevision) {
    return {
      label: statusLabel[campaign.activeRevision.status],
      tone: campaign.activeRevision.status === 'APPROVED' ? 'success' : 'danger',
    };
  }
  const latest = campaign.revisions[0];
  return latest
    ? { label: statusLabel[latest.status], tone: latest.status === 'REJECTED' ? 'danger' : 'muted' }
    : { label: 'Draft', tone: 'muted' };
}

function metric(value: string) {
  try {
    return new Intl.NumberFormat('en').format(BigInt(value));
  } catch {
    return value;
  }
}

export function KeywordMarketCampaignList() {
  const [campaigns, setCampaigns] = useState<AdCampaignView[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      setCampaigns(await getMyAdCampaigns());
      setState('ready');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setState('signed-out');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Campaigns could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(AUTH_CHANGED_EVENT, load);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, load);
  }, [load]);

  return (
    <main className="keyword-market-app-shell">
      <header className="keyword-market-page-heading">
        <div>
          <span className="keyword-market-eyebrow">Advertiser workspace</span>
          <h1>Your keyword positions.</h1>
          <p>Creative and campaign controls are off-chain. Stake is a verified chain projection.</p>
        </div>
        <div className="keyword-market-heading-actions">
          <ActionButton icon={<RefreshCw size={15} />} onClick={() => void load()}>
            Refresh
          </ActionButton>
          <Link className="keyword-market-primary-link" href="/keyword-market/campaigns/new">
            <Plus size={15} /> New campaign
          </Link>
        </div>
      </header>

      {state === 'loading' ? (
        <div className="keyword-market-access-state">
          <LoaderCircle className="animate-spin" />
          <strong>Loading campaign ledger…</strong>
        </div>
      ) : null}
      {state === 'signed-out' ? (
        <div className="keyword-market-access-state">
          <WalletCards />
          <strong>Sign in with your advertiser wallet</strong>
          <p>The SIWE session must use the same wallet that owns the keyword campaign.</p>
          <ActionButton
            variant="primary"
            onClick={() => window.dispatchEvent(new Event(AUTH_SIGN_IN_REQUESTED_EVENT))}
          >
            Connect and sign in
          </ActionButton>
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="keyword-market-access-state keyword-market-error-state">
          <CircleAlert />
          <strong>Campaigns unavailable</strong>
          <p>{error}</p>
          <ActionButton onClick={() => void load()}>Try again</ActionButton>
        </div>
      ) : null}
      {state === 'ready' && campaigns.length === 0 ? (
        <div className="keyword-market-access-state">
          <span className="keyword-market-empty-index">00</span>
          <strong>No campaigns yet</strong>
          <p>Reserve the creative now. Stake actions will unlock after the contract handoff.</p>
          <Link className="keyword-market-primary-link" href="/keyword-market/campaigns/new">
            Create first campaign <ArrowRight size={15} />
          </Link>
        </div>
      ) : null}
      {state === 'ready' && campaigns.length > 0 ? (
        <section className="keyword-market-ledger" aria-label="Campaigns">
          <div className="keyword-market-ledger-head">
            <span>Keyword</span>
            <span>Status</span>
            <span>Rank / stake</span>
            <span>30 day resolves</span>
            <span aria-hidden="true" />
          </div>
          {campaigns.map((campaign, index) => {
            const status = campaignStatus(campaign);
            return (
              <Link
                className="keyword-market-ledger-row"
                href={`/keyword-market/campaigns/${campaign.id}`}
                key={campaign.id}
                style={{ '--keyword-market-row-index': index } as React.CSSProperties}
              >
                <span className="keyword-market-ledger-keyword">
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <strong>{campaign.keyword}</strong>
                </span>
                <span className={`keyword-market-status keyword-market-status-${status.tone}`}>
                  {status.label}
                </span>
                <span>
                  {campaign.position ? (
                    <>
                      <strong>#{campaign.position.rank}</strong>
                      <small>{campaign.position.stakeRaw} raw</small>
                    </>
                  ) : (
                    <small>No chain position</small>
                  )}
                </span>
                <span>
                  <strong>{metric(campaign.activeRevision?.last30DaysResolutions ?? '0')}</strong>
                  <small>
                    lifetime {metric(campaign.activeRevision?.lifetimeResolutions ?? '0')}
                  </small>
                </span>
                <ArrowRight size={16} />
              </Link>
            );
          })}
        </section>
      ) : null}
    </main>
  );
}
