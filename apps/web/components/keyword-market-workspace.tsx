'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  LoaderCircle,
  Plus,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  AD_REPORT_REASONS,
  tokenizeAdsText,
  type AdReportReasonCode,
  type AdResolveResponse,
} from '@precommunity/shared';
import { ActionButton } from './action-button';
import { KeywordMarketCreativePreview } from './keyword-market-creative-preview';
import {
  getKeywordMarketStatus,
  reportAd,
  resolveAd,
  type KeywordMarketChainSnapshot,
} from '@/lib/keyword-market-api';

const reasonLabels: Record<AdReportReasonCode, string> = {
  SCAM_PHISHING: 'Scam or phishing',
  MISLEADING: 'Misleading',
  INAPPROPRIATE: 'Inappropriate',
  BROKEN_LINK: 'Broken link',
  OTHER: 'Other',
};

function QueryMatch({ query, keyword }: { query: string; keyword?: string }) {
  const tokens = tokenizeAdsText(query).map((token) => token.value);
  const matched = keyword?.split(' ') ?? [];
  const start = tokens.findIndex((_, index) =>
    matched.every((token, offset) => tokens[index + offset] === token),
  );
  if (!tokens.length) return <span className="text-muted">Waiting for a query</span>;
  return (
    <span className="keyword-market-token-line">
      {tokens.map((token, index) => (
        <span
          className={
            start >= 0 && index >= start && index < start + matched.length ? 'matched' : ''
          }
          key={`${token}-${index}`}
        >
          {token}
        </span>
      ))}
    </span>
  );
}

export function KeywordMarketWorkspace({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<AdResolveResponse | null>(null);
  const [status, setStatus] = useState<KeywordMarketChainSnapshot | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<AdReportReasonCode>('SCAM_PHISHING');
  const [reportComment, setReportComment] = useState('');
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    getKeywordMarketStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!initialQuery.trim()) return;
    let active = true;
    setState('loading');
    resolveAd(initialQuery)
      .then((response) => {
        if (!active) return;
        setResult(response);
        setState('ready');
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'The resolver could not complete.');
        setState('error');
      });
    return () => {
      active = false;
    };
  }, [initialQuery]);

  const endpoint = '/v1/keyword-market/resolve';
  const resultStateLabel =
    state === 'idle'
      ? 'No query'
      : state === 'loading'
        ? 'Resolving'
        : state === 'error'
          ? 'Error'
          : result?.ad
            ? 'Selected'
            : 'No match';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setReportOpen(false);
    setReportState('idle');
    setState('loading');
    setResult(null);
    try {
      setResult(await resolveAd(query));
      setState('ready');
    } catch (reason) {
      setState('error');
      setError(reason instanceof Error ? reason.message : 'The resolver could not complete.');
    }
  }

  async function sendReport() {
    if (!result?.ad) return;
    setReportState('sending');
    try {
      await reportAd(result.ad.revisionId, {
        reason: reportReason,
        comment: reportComment.trim() || undefined,
      });
      setReportState('sent');
    } catch (reason) {
      setReportState('idle');
      setError(reason instanceof Error ? reason.message : 'The report could not be sent.');
    }
  }

  return (
    <main className="keyword-market-app-shell keyword-market-resolver-shell">
      <section className="keyword-market-resolver-stage">
        <div className="keyword-market-stage-copy">
          <span className="keyword-market-eyebrow">Public resolver · algorithm v1</span>
          <h1>Stake on a keyword.</h1>
          <p>
            The longest whole-token keyword wins first. The highest eligible PRE stake wins inside
            that keyword.
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try: bitcoin"
            maxLength={256}
            autoComplete="off"
          />
          <button
            className="keyword-market-resolve-button"
            type="submit"
            disabled={state === 'loading' || !query.trim()}
          >
            {state === 'loading' ? <LoaderCircle className="animate-spin" size={16} /> : null}
            <span>{state === 'loading' ? 'Resolving…' : 'Resolve'}</span>
            {state !== 'loading' ? <ArrowRight size={16} aria-hidden="true" /> : null}
          </button>
        </form>
        <div className="keyword-market-query-inspector" aria-live="polite">
          <span className="keyword-market-query-dot" aria-hidden="true" />
          <QueryMatch query={query} keyword={result?.ad?.matchedKeyword} />
          <span className="keyword-market-query-separator" aria-hidden="true">
            /
          </span>
          <span className="keyword-market-inspector-label">Whole-token match</span>
        </div>
      </section>

      <section className="keyword-market-result-grid">
        <div className="keyword-market-result-main">
          <header className="keyword-market-section-heading">
            <div>
              <span className="keyword-market-eyebrow">Resolver output</span>
              <h2>Selected ad</h2>
            </div>
            <div className="keyword-market-result-heading-actions">
              <span className="keyword-market-result-state" aria-live="polite">
                {resultStateLabel}
              </span>
              {result?.ad ? (
                <button
                  className="keyword-market-report-trigger"
                  type="button"
                  onClick={() => setReportOpen(true)}
                >
                  <ShieldAlert size={14} /> Report ad
                </button>
              ) : null}
            </div>
          </header>
          {state === 'idle' ? (
            <div className="keyword-market-resolver-empty-state">
              <span className="keyword-market-resolver-empty-icon" aria-hidden="true">
                <Plus size={18} />
              </span>
              <div>
                <strong>Enter a keyword to inspect the result</strong>
                <p>
                  The resolver deterministically selects the eligible campaign with the highest
                  stake for the winning token.
                </p>
              </div>
              <span className="keyword-market-resolver-empty-arrow" aria-hidden="true">
                <ArrowDown size={19} />
              </span>
            </div>
          ) : null}
          {state === 'loading' ? (
            <div className="keyword-market-resolver-empty-state">
              <span className="keyword-market-resolver-empty-icon" aria-hidden="true">
                <LoaderCircle className="animate-spin" size={18} />
              </span>
              <div>
                <strong>Resolving candidates…</strong>
                <p>Checking whole-token matches and their eligible campaign stakes.</p>
              </div>
            </div>
          ) : null}
          {state === 'error' ? (
            <div className="keyword-market-resolver-empty-state keyword-market-resolver-error-state">
              <span className="keyword-market-resolver-empty-icon" aria-hidden="true">
                <ShieldAlert size={18} />
              </span>
              <div>
                <strong>The query could not be resolved</strong>
                <p>{error}</p>
              </div>
            </div>
          ) : null}
          {state === 'ready' && !result?.ad ? (
            <div className="keyword-market-resolver-empty-state">
              <span className="keyword-market-resolver-empty-icon" aria-hidden="true">
                <Plus size={18} />
              </span>
              <div>
                <strong>No eligible ad</strong>
                <p>
                  {status?.status === 'AWAITING_CONTRACT'
                    ? 'The staking contract adapter is awaiting its reviewed ABI.'
                    : 'No matched keyword has an approved creative and active stake.'}
                </p>
              </div>
            </div>
          ) : null}
          {result?.ad ? (
            <>
              <KeywordMarketCreativePreview
                creative={result.ad}
                keyword={result.ad.matchedKeyword}
                interactive
              />
              <dl className="keyword-market-proof-list">
                <div>
                  <dt>Stake</dt>
                  <dd>{result.ad.proof.stakeRaw} raw PRE</dd>
                </div>
                <div>
                  <dt>Advertiser</dt>
                  <dd>{result.ad.proof.stakerAddress}</dd>
                </div>
                <div>
                  <dt>Position block</dt>
                  <dd>{result.ad.proof.positionBlock}</dd>
                </div>
                <div>
                  <dt>Indexed through</dt>
                  <dd>{result.ad.proof.indexedThroughBlock ?? 'Syncing'}</dd>
                </div>
              </dl>
            </>
          ) : null}
          {reportOpen && result?.ad ? (
            <div className="keyword-market-report-form">
              <div>
                <span className="keyword-market-eyebrow">Anonymous report</span>
                <h3>What is wrong with this ad?</h3>
              </div>
              <select
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value as AdReportReasonCode)}
              >
                {AD_REPORT_REASONS.map((reason) => (
                  <option value={reason} key={reason}>
                    {reasonLabels[reason]}
                  </option>
                ))}
              </select>
              <textarea
                value={reportComment}
                onChange={(event) => setReportComment(event.target.value)}
                maxLength={500}
                placeholder="Optional context for the moderator"
              />
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton
                  variant="primary"
                  onClick={() => void sendReport()}
                  disabled={reportState !== 'idle'}
                >
                  {reportState === 'sending'
                    ? 'Sending…'
                    : reportState === 'sent'
                      ? 'Report received'
                      : 'Submit report'}
                </ActionButton>
                <ActionButton onClick={() => setReportOpen(false)}>Close</ActionButton>
                {reportState === 'sent' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success">
                    <Check size={14} /> Awaiting moderator review
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="keyword-market-context-rail">
          <div>
            <span className="keyword-market-eyebrow">Chain status</span>
            <strong className="keyword-market-rail-value">
              <span className="keyword-market-chain-dot" aria-hidden="true" />
              {status?.status.replaceAll('_', ' ') ?? 'Checking'}
            </strong>
            <p>
              Stake controls stay disabled until the contract ABI, deployment block and event map
              are reviewed.
            </p>
          </div>
          <dl>
            <div>
              <dt>Network</dt>
              <dd>{status?.chainId ?? '—'}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>{status?.contractAddress ?? 'Not configured'}</dd>
            </div>
            <div>
              <dt>Resolver API</dt>
              <dd className="break-all">{endpoint}</dd>
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
