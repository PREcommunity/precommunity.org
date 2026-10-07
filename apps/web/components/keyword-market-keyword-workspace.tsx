'use client';

import type { AdKeywordResponse } from '@precommunity/shared';
import { ArrowLeft, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeywordMarketRefresh } from '@/hooks/use-keyword-market-refresh';
import { getAdKeyword } from '@/lib/keyword-market-api';
import { ActionButton } from './action-button';
import { KeywordMarketRanking } from './keyword-market-ranking';

export function KeywordMarketKeywordWorkspace({ keyword }: { keyword: string }) {
  const [data, setData] = useState<AdKeywordResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const loadInFlight = useRef(false);

  const load = useCallback(
    async (background = false) => {
      if (loadInFlight.current) return;
      loadInFlight.current = true;
      if (!background) {
        setState('loading');
        setError('');
      }
      try {
        setData(await getAdKeyword(keyword));
        setState('ready');
      } catch (reason) {
        if (!background) {
          setError(
            reason instanceof Error ? reason.message : 'Keyword ranking could not be loaded.',
          );
          setState('error');
        }
      } finally {
        loadInFlight.current = false;
      }
    },
    [keyword],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useKeywordMarketRefresh(load, state === 'ready');

  return (
    <main className="keyword-market-app-shell">
      <header className="keyword-market-page-heading keyword-market-campaign-heading">
        <div>
          <Link
            className="keyword-market-back-link"
            href={`/keyword-market?q=${encodeURIComponent(keyword)}`}
          >
            <ArrowLeft size={14} /> Search
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
            <KeywordMarketRanking data={data} />
          ) : (
            <div className="keyword-market-access-state">
              <span className="keyword-market-empty-index">00</span>
              <strong>No confirmed positions</strong>
              <p>
                {data.chainStatus === 'AWAITING_CONTRACT'
                  ? 'The market contract and deployment block are not configured yet.'
                  : 'This keyword has no active stakes.'}
              </p>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
