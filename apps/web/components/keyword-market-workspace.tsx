'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  BASE_MAINNET_DEPLOYMENT,
  BASE_SEPOLIA_DEPLOYMENT,
  normalizeAdKeyword,
  type AdCampaignView,
  type AdKeywordResponse,
} from '@precommunity/shared';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { explorerAddressUrl } from '@/lib/deployment';
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
  const [searchedKeyword, setSearchedKeyword] = useState('');
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
  const [searchReady, setSearchReady] = useState(false);
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
    setSearchedKeyword(keyword);
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
    setSearchedKeyword('');
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
    setSearchReady(true);
    return () => {
      searchRequest.current += 1;
    };
  }, [initialQuery, searchKeyword]);

  const chainId = result?.chainId ?? status?.chainId;
  const contractAddress = result?.contractAddress ?? status?.contractAddress;
  const deployment = [BASE_MAINNET_DEPLOYMENT, BASE_SEPOLIA_DEPLOYMENT].find(
    (network) => network.chainId === chainId,
  );
  const currentOwnership = ownership?.address === sessionAddress ? ownership : null;
  const ownedCampaign =
    currentOwnership?.state === 'ready'
      ? currentOwnership.campaigns.find((campaign) => campaign.keyword === searchedKeyword)
      : undefined;
  const ownershipLoading = !sessionReady || Boolean(sessionAddress && !currentOwnership);
  const ownershipError =
    sessionAddress && currentOwnership?.state === 'error' ? currentOwnership.error : '';
  const noPositions = state === 'ready' && result?.positions.length === 0;
  const hasPositions = state === 'ready' && Boolean(result?.positions.length);
  const ownedPosition = result?.positions.some(
    (position) => position.stakerAddress.toLowerCase() === sessionAddress?.toLowerCase(),
  );
  const actionLabel = noPositions ? 'Create stake' : ownedCampaign ? 'Edit' : 'New stake';
  const actionIcon =
    ownedCampaign && !noPositions ? (
      <Pencil size={16} aria-hidden="true" />
    ) : (
      <Plus size={16} aria-hidden="true" />
    );
  const actionHref =
    searchedKeyword && !ownershipLoading && !ownershipError
      ? ownedCampaign
        ? `/keyword-market/campaigns/${encodeURIComponent(ownedCampaign.id)}`
        : `/keyword-market/campaigns/new?keyword=${encodeURIComponent(searchedKeyword)}`
      : null;
  const campaignAction = !searchedKeyword ? null : actionHref ? (
    <Link className="keyword-market-primary-link" href={actionHref}>
      {actionIcon}
      {actionLabel}
    </Link>
  ) : (
    <ActionButton
      disabled
      icon={
        ownershipLoading && searchedKeyword ? (
          <LoaderCircle className="animate-spin" size={16} />
        ) : (
          actionIcon
        )
      }
    >
      {ownershipLoading && searchedKeyword ? 'Checking ownership…' : actionLabel}
    </ActionButton>
  );

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
            disabled={!searchReady}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try: bitcoin"
            maxLength={256}
            autoComplete="off"
            aria-invalid={Boolean(normalized.error)}
            aria-describedby="keyword-market-query-inspector"
          />
          <button
            className="keyword-market-resolve-button"
            type="submit"
            disabled={!searchReady || state === 'loading' || !normalized.keyword}
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
            {hasPositions && !ownedCampaign ? (
              <div className="keyword-market-result-heading-actions">{campaignAction}</div>
            ) : null}
          </header>
          {searchedKeyword && ownershipError ? (
            <div className="keyword-market-inline-error" role="alert">
              <p>{ownershipError}</p>
              <ActionButton onClick={() => setOwnershipVersion((version) => version + 1)}>
                Check campaigns again
              </ActionButton>
            </div>
          ) : null}
          {state === 'idle' || noPositions ? (
            <div className="keyword-market-resolver-empty-state">
              <div className="col-span-full">
                <strong>
                  {noPositions ? 'No stakes yet' : 'Search a keyword to inspect its stake ranking'}
                </strong>
                <p>
                  {noPositions
                    ? ownedCampaign
                      ? 'Add a stake to your existing campaign for this keyword.'
                      : 'Be the first to stake on this keyword.'
                    : 'Enter a keyword, then press Enter or click Search.'}
                </p>
                {noPositions ? <div className="mt-4">{campaignAction}</div> : null}
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionButton
                    disabled={!searchedKeyword}
                    onClick={() => searchedKeyword && void searchKeyword(searchedKeyword)}
                  >
                    Try again
                  </ActionButton>
                  {campaignAction}
                </div>
              </div>
            </div>
          ) : null}
          {state === 'ready' && result && result.positions.length > 0 ? (
            <>
              <KeywordMarketRanking
                key={result.keyword}
                data={result}
                editHref={ownedCampaign && actionHref ? actionHref : undefined}
              />
              {ownedCampaign && !ownedPosition ? (
                <div className="mt-4">{campaignAction}</div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
      <aside className="keyword-market-context-rail" aria-label="Chain status">
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
            <dd>{chainId ?? '—'}</dd>
          </div>
          <div>
            <dt>Contract</dt>
            <dd>
              {contractAddress && deployment ? (
                <a
                  className="keyword-market-text-link"
                  href={explorerAddressUrl(contractAddress, deployment)}
                  target="_blank"
                  rel="noreferrer"
                  title={contractAddress}
                  aria-label={`View contract ${contractAddress} on BaseScan (opens in a new tab)`}
                >
                  {contractAddress.slice(0, 12)}…{contractAddress.slice(-6)}
                  <ArrowUpRight size={12} aria-hidden="true" />
                </a>
              ) : (
                (contractAddress ?? 'Not configured')
              )}
            </dd>
          </div>
        </dl>
        <Link className="keyword-market-text-link" href="/keyword-market/campaigns">
          Manage campaigns <ArrowRight size={15} />
        </Link>
      </aside>
    </main>
  );
}
