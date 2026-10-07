'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Pencil, Plus, Search, ShieldAlert } from 'lucide-react';
import {
  normalizeAdKeyword,
  type AdCampaignView,
  type AdKeywordResponse,
} from '@precommunity/shared';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import {
  getAdKeyword,
  getKeywordMarketStatus,
  getMyAdCampaigns,
  type KeywordMarketChainSnapshot,
} from '@/lib/keyword-market-api';
import { ActionButton } from './action-button';
import { KeywordMarketRanking } from './keyword-market-ranking';

export function KeywordMarketWorkspace({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<AdKeywordResponse | null>(null);
  const [status, setStatus] = useState<KeywordMarketChainSnapshot | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [ownership, setOwnership] = useState<{
    address: string;
    state: 'ready' | 'error';
    campaigns: AdCampaignView[];
    error: string;
  } | null>(null);
  const [ownershipVersion, setOwnershipVersion] = useState(0);
  const searchRequest = useRef(0);
  const ownershipRequest = useRef(0);
  const { sessionAddress, sessionReady } = useWalletSession();
  const normalized = useMemo(() => {
    if (!query.trim()) return { keyword: '', error: '' };
    try {
      return { keyword: normalizeAdKeyword(query), error: '' };
    } catch (reason) {
      return { keyword: '', error: reason instanceof Error ? reason.message : 'Invalid keyword.' };
    }
  }, [query]);

  useEffect(() => {
    let active = true;
    getKeywordMarketStatus()
      .then((response) => {
        if (active) setStatus(response);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      ownershipRequest.current += 1;
      setOwnership(null);
      setOwnershipVersion((version) => version + 1);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const request = ++ownershipRequest.current;
    setOwnership(null);
    if (!sessionReady || !sessionAddress) return;
    let active = true;
    getMyAdCampaigns()
      .then((campaigns) => {
        if (!active || request !== ownershipRequest.current) return;
        setOwnership({ address: sessionAddress, state: 'ready', campaigns, error: '' });
      })
      .catch((reason) => {
        if (!active || request !== ownershipRequest.current) return;
        setOwnership({
          address: sessionAddress,
          state: 'error',
          campaigns: [],
          error: reason instanceof Error ? reason.message : 'Your campaigns could not be checked.',
        });
      });
    return () => {
      active = false;
    };
  }, [sessionAddress, sessionReady, ownershipVersion]);

  const searchKeyword = useCallback(async (keyword: string) => {
    const request = ++searchRequest.current;
    setError('');
    setResult(null);
    setState('loading');
    try {
      const response = await getAdKeyword(keyword);
      if (request !== searchRequest.current) return;
      setResult(response);
      setState('ready');
    } catch (reason) {
      if (request !== searchRequest.current) return;
      setError(
        reason instanceof Error ? reason.message : 'The keyword ranking could not be loaded.',
      );
      setState('error');
    }
  }, []);

  useEffect(() => {
    setQuery(initialQuery);
    setResult(null);
    setError('');
    setState('idle');
    if (initialQuery.trim()) {
      try {
        void searchKeyword(normalizeAdKeyword(initialQuery));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Invalid keyword.');
        setState('error');
      }
    }
    return () => {
      searchRequest.current += 1;
    };
  }, [initialQuery, searchKeyword]);

  const currentOwnership = ownership?.address === sessionAddress ? ownership : null;
  const ownedCampaign =
    currentOwnership?.state === 'ready'
      ? currentOwnership.campaigns.find((campaign) => campaign.keyword === normalized.keyword)
      : undefined;
  const ownershipLoading = !sessionReady || Boolean(sessionAddress && !currentOwnership);
  const ownershipError =
    sessionAddress && currentOwnership?.state === 'error' ? currentOwnership.error : '';
  const actionLabel = ownedCampaign ? 'Edit' : 'New stake';
  const actionIcon = ownedCampaign ? (
    <Pencil size={16} aria-hidden="true" />
  ) : (
    <Plus size={16} aria-hidden="true" />
  );
  const actionHref =
    normalized.keyword && !ownershipLoading && !ownershipError
      ? ownedCampaign
        ? `/keyword-market/campaigns/${encodeURIComponent(ownedCampaign.id)}`
        : `/keyword-market/campaigns/new?keyword=${encodeURIComponent(normalized.keyword)}`
      : null;
  const noPositions = state === 'ready' && result?.positions.length === 0;

  function changeQuery(value: string) {
    searchRequest.current += 1;
    setQuery(value);
    setResult(null);
    setState('idle');
    setError('');
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (normalized.keyword) void searchKeyword(normalized.keyword);
  }

  return (
    <main className="keyword-market-app-shell keyword-market-resolver-shell">
      <section className="keyword-market-resolver-stage">
        <div className="keyword-market-stage-copy">
          <span className="keyword-market-eyebrow">Keyword search · public stake ranking</span>
          <h1>Stake on a keyword.</h1>
          <p>
            Find a search phrase, inspect its stake ranking, and create or manage your campaign.
          </p>
        </div>
        <form className="keyword-market-search-form" onSubmit={submit}>
          <Search size={20} aria-hidden="true" />
          <label className="sr-only" htmlFor="keyword-market-query">
            Search query
          </label>
          <input
            id="keyword-market-query"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Try: bitcoin"
            maxLength={256}
            autoComplete="off"
            aria-invalid={Boolean(normalized.error)}
            aria-describedby="keyword-market-query-inspector"
          />
          <button
            className="keyword-market-resolve-button"
            type="submit"
            disabled={state === 'loading' || !normalized.keyword}
          >
            {state === 'loading' ? <LoaderCircle className="animate-spin" size={16} /> : null}
            <span>{state === 'loading' ? 'Searching…' : 'Search'}</span>
            {state !== 'loading' ? <ArrowRight size={16} aria-hidden="true" /> : null}
          </button>
        </form>
        <div
          id="keyword-market-query-inspector"
          className="keyword-market-query-inspector"
          aria-live="polite"
        >
          <span className="keyword-market-query-dot" aria-hidden="true" />
          <span>{normalized.error || normalized.keyword || 'Enter a keyword'}</span>
          {!normalized.error ? (
            <span className="keyword-market-inspector-label">1–5 tokens · 64 characters</span>
          ) : null}
        </div>
      </section>
      <section className="keyword-market-result-grid">
        <div className="keyword-market-result-main min-w-0">
          <header className="keyword-market-section-heading">
            <div>
              <span className="keyword-market-eyebrow">Public keyword ledger</span>
              <h2>Keyword ranking</h2>
            </div>
            <div className="keyword-market-result-heading-actions">
              {actionHref ? (
                <Link className="keyword-market-primary-link" href={actionHref}>
                  {actionIcon}
                  {actionLabel}
                </Link>
              ) : (
                <ActionButton
                  disabled
                  icon={
                    ownershipLoading && normalized.keyword ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      actionIcon
                    )
                  }
                >
                  {ownershipLoading && normalized.keyword ? 'Checking ownership…' : actionLabel}
                </ActionButton>
              )}
            </div>
          </header>
          {ownershipError ? (
            <div className="keyword-market-inline-error" role="alert">
              <p>{ownershipError}</p>
              <ActionButton onClick={() => setOwnershipVersion((version) => version + 1)}>
                Check campaigns again
              </ActionButton>
            </div>
          ) : null}
          {state === 'idle' || noPositions ? (
            <div className="keyword-market-resolver-empty-state">
              {actionHref ? (
                <Link
                  className="keyword-market-resolver-empty-icon"
                  href={actionHref}
                  aria-label={`${actionLabel} for ${normalized.keyword}`}
                >
                  {actionIcon}
                </Link>
              ) : (
                <span className="keyword-market-resolver-empty-icon" aria-hidden="true">
                  {actionIcon}
                </span>
              )}
              <div>
                <strong>
                  {noPositions
                    ? 'No confirmed positions'
                    : 'Search a keyword to inspect its stake ranking'}
                </strong>
                <p>
                  {noPositions
                    ? 'Create a campaign for this phrase, or manage your existing campaign.'
                    : 'You can create or edit a campaign as soon as you enter a valid phrase.'}
                </p>
              </div>
            </div>
          ) : null}
          {state === 'loading' ? (
            <div className="keyword-market-resolver-empty-state">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              <div>
                <strong>Reading indexed positions…</strong>
                <p>Checking stake and bids for this keyword.</p>
              </div>
            </div>
          ) : null}
          {state === 'error' ? (
            <div className="keyword-market-resolver-empty-state keyword-market-resolver-error-state">
              <ShieldAlert aria-hidden="true" />
              <div>
                <strong>Ranking unavailable</strong>
                <p>{error}</p>
                <ActionButton
                  disabled={!normalized.keyword}
                  onClick={() => normalized.keyword && void searchKeyword(normalized.keyword)}
                >
                  Try again
                </ActionButton>
              </div>
            </div>
          ) : null}
          {state === 'ready' && result && result.positions.length > 0 ? (
            <KeywordMarketRanking data={result} />
          ) : null}
        </div>
        <aside className="keyword-market-context-rail">
          <div>
            <span className="keyword-market-eyebrow">Chain status</span>
            <strong className="keyword-market-rail-value">
              <span className="keyword-market-chain-dot" aria-hidden="true" />
              {(result?.chainStatus ?? status?.status)?.replaceAll('_', ' ') ?? 'Checking'}
            </strong>
            <p>Stake controls use the finalized blockchain index.</p>
          </div>
          <dl>
            <div>
              <dt>Network</dt>
              <dd>{result?.chainId ?? status?.chainId ?? '—'}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>{result?.contractAddress ?? status?.contractAddress ?? 'Not configured'}</dd>
            </div>
          </dl>
          <Link className="keyword-market-text-link" href="/keyword-market/campaigns">
            Manage campaigns <ArrowRight size={15} />
          </Link>
        </aside>
      </section>
    </main>
  );
}
