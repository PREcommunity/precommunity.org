'use client';

import type { AdKeywordResponse } from '@precommunity/shared';
import { ArrowLeft, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getAdKeyword } from '@/lib/keyword-market-api';
import { ActionButton } from './action-button';

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function KeywordMarketKeywordWorkspace({ keyword }: { keyword: string }) {
  const [data, setData] = useState<AdKeywordResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      setData(await getAdKeyword(keyword));
      setState('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Keyword ranking could not be loaded.');
      setState('error');
    }
  }, [keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="keyword-market-app-shell">
      <header className="keyword-market-page-heading keyword-market-campaign-heading">
        <div>
          <Link
            className="keyword-market-back-link"
            href={`/keyword-market?q=${encodeURIComponent(keyword)}`}
          >
            <ArrowLeft size={14} /> Resolver
          </Link>
          <span className="keyword-market-eyebrow">Public keyword ledger</span>
          <h1>{data?.keyword ?? keyword}</h1>
          <p>Stake ranking and chain proof are public. Competing creative content stays private.</p>
        </div>
        <ActionButton icon={<RefreshCw size={15} />} onClick={() => void load()}>
          Refresh proof
        </ActionButton>
      </header>

      {state === 'loading' ? (
        <div className="keyword-market-access-state">
          <LoaderCircle className="animate-spin" />
          <strong>Reading indexed positions…</strong>
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="keyword-market-access-state keyword-market-error-state">
          <CircleAlert />
          <strong>Ranking unavailable</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {state === 'ready' && data ? (
        <>
          <section className="keyword-market-chain-strip">
            <div>
              <span>Status</span>
              <strong>{data.chainStatus.replaceAll('_', ' ')}</strong>
            </div>
            <div>
              <span>Chain</span>
              <strong>{data.chainId}</strong>
            </div>
            <div>
              <span>Contract</span>
              <strong>{data.contractAddress ?? 'Not configured'}</strong>
            </div>
            <div>
              <span>Indexed through</span>
              <strong>{data.indexedThroughBlock ?? '—'}</strong>
            </div>
          </section>
          {data.positions.length ? (
            <section
              className="keyword-market-ledger keyword-market-ranking-ledger"
              aria-label={`Stake ranking for ${data.keyword}`}
            >
              <div className="keyword-market-ledger-head">
                <span>Rank / staker</span>
                <span>Active stake</span>
                <span>Amount since</span>
                <span>Proof</span>
                <span>Eligible</span>
              </div>
              {data.positions.map((position, index) => (
                <div
                  className="keyword-market-ledger-row"
                  key={position.stakerAddress}
                  style={{ '--keyword-market-row-index': index } as React.CSSProperties}
                >
                  <span className="keyword-market-ledger-keyword">
                    <small>#{position.rank}</small>
                    <strong title={position.stakerAddress}>
                      {shortAddress(position.stakerAddress)}
                    </strong>
                  </span>
                  <span>
                    <strong>{position.stakeRaw}</strong>
                    <small>raw PRE</small>
                  </span>
                  <span>
                    <strong>{position.amountSinceBlock}</strong>
                    <small>log {position.amountSinceLogIndex}</small>
                  </span>
                  <span>
                    <strong>{position.positionBlock}</strong>
                    <small title={position.positionTxHash}>
                      {position.positionTxHash.slice(0, 12)}…
                    </small>
                  </span>
                  <span
                    className={`keyword-market-status ${position.hasEligibleAd ? 'keyword-market-status-success' : 'keyword-market-status-muted'}`}
                  >
                    {position.hasEligibleAd ? 'Eligible' : 'No approved ad'}
                  </span>
                </div>
              ))}
            </section>
          ) : (
            <div className="keyword-market-access-state">
              <span className="keyword-market-empty-index">00</span>
              <strong>No confirmed positions</strong>
              <p>
                {data.chainStatus === 'AWAITING_CONTRACT'
                  ? 'The contract adapter is waiting for its reviewed ABI and deployment details.'
                  : 'This keyword has no active stakes.'}
              </p>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
