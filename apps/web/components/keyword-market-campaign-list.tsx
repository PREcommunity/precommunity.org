'use client';

import { PRE_DECIMALS, type AdCampaignView, type AdCreativeStatusCode } from '@precommunity/shared';
import {
  ArrowRight,
  CircleAlert,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { useKeywordMarketRefresh } from '@/hooks/use-keyword-market-refresh';
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

const PAGE_SIZE = 20;

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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const loadInFlight = useRef(false);
  const pendingLoad = useRef<(() => Promise<void>) | null>(null);
  const sessionGeneration = useRef(0);

  const load = useCallback(async function loadCampaigns(background = false): Promise<void> {
    if (loadInFlight.current) {
      if (!background) pendingLoad.current = () => loadCampaigns();
      return;
    }
    loadInFlight.current = true;
    const generation = sessionGeneration.current;
    if (!background) {
      setState('loading');
      setError('');
    }
    try {
      const nextCampaigns = await getMyAdCampaigns();
      if (generation !== sessionGeneration.current) return;
      setCampaigns(nextCampaigns);
      setState('ready');
    } catch (reason) {
      if (generation !== sessionGeneration.current) return;
      if (reason instanceof ApiError && reason.status === 401) {
        setCampaigns([]);
        setState('signed-out');
        return;
      }
      if (!background) {
        setError(reason instanceof Error ? reason.message : 'Campaigns could not be loaded.');
        setState('error');
      }
    } finally {
      loadInFlight.current = false;
      const pending = pendingLoad.current;
      pendingLoad.current = null;
      void pending?.();
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      sessionGeneration.current += 1;
      setCampaigns([]);
      setSearch('');
      setPage(1);
      setState('loading');
      setError('');
      void load();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
  }, [load]);
  useKeywordMarketRefresh(load, state === 'ready');

  const filteredCampaigns = campaigns.filter((campaign) =>
    campaign.keyword.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(filteredCampaigns.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleCampaigns = filteredCampaigns.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

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
        <>
          <div className="keyword-market-campaign-search">
            <label className="keyword-market-campaign-search-input">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search keywords"
                placeholder="Search keywords"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            {search ? (
              <ActionButton
                size="compact"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
              >
                Clear search
              </ActionButton>
            ) : null}
            <span aria-live="polite">
              {filteredCampaigns.length} {filteredCampaigns.length === 1 ? 'campaign' : 'campaigns'}
            </span>
          </div>
          {filteredCampaigns.length === 0 ? (
            <div className="keyword-market-access-state">
              <strong>No matching campaigns</strong>
              <p>Try another keyword or clear the search.</p>
            </div>
          ) : (
            <section
              className="keyword-market-ledger keyword-market-campaign-ledger"
              aria-label="Campaigns"
            >
              <div className="keyword-market-ledger-head">
                <span>Keyword</span>
                <span>Status</span>
                <span>Rank / USD bid</span>
                <span>Stake</span>
                <span title="Total ad views across all campaign creatives">Views</span>
                <span title="Total ad clicks across all campaign creatives">Clicks</span>
                <span aria-hidden="true" />
              </div>
              {visibleCampaigns.map((campaign, index) => {
                const status = campaignStatus(campaign);
                return (
                  <Link
                    className="keyword-market-ledger-row"
                    href={`/keyword-market/campaigns/${campaign.id}`}
                    key={campaign.id}
                    style={{ '--keyword-market-row-index': index } as React.CSSProperties}
                  >
                    <span className="keyword-market-ledger-keyword">
                      <small>{String(pageStart + index + 1).padStart(2, '0')}</small>
                      <strong>{campaign.keyword}</strong>
                    </span>
                    <span className={`keyword-market-status keyword-market-status-${status.tone}`}>
                      {status.label}
                    </span>
                    <span>
                      {campaign.position ? (
                        <>
                          <strong>
                            {campaign.position.eligible ? `#${campaign.position.rank}` : 'Inactive'}
                          </strong>
                          <small>
                            ${formatUnits(BigInt(campaign.position.bidUsdRaw), 6)} / click
                          </small>
                        </>
                      ) : (
                        <small>No chain position</small>
                      )}
                    </span>
                    <span>
                      <strong>
                        {formatUnits(BigInt(campaign.position?.stakeRaw ?? '0'), PRE_DECIMALS)} PRE
                      </strong>
                    </span>
                    <span>
                      <strong>{metric(campaign.lifetimeViews)}</strong>
                    </span>
                    <span>
                      <strong>{metric(campaign.lifetimeClicks)}</strong>
                    </span>
                    <ArrowRight size={16} />
                  </Link>
                );
              })}
            </section>
          )}
          {pageCount > 1 ? (
            <nav className="keyword-market-campaign-pagination" aria-label="Campaign pagination">
              <ActionButton
                size="compact"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </ActionButton>
              <span aria-live="polite">
                Page {currentPage} of {pageCount}
              </span>
              <ActionButton
                size="compact"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </ActionButton>
            </nav>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
