'use client';

import type { AdAdminKeywordPage } from '@precommunity/shared';
import { ArrowUpRight, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { formatPreAmount } from '@/lib/format';
import { ApiError, clientApiJson } from '@/lib/http';
import { ActionButton } from './action-button';

const endpoint = '/v1/admin/keyword-market/keywords';

export function KeywordMarketKeywordsPanel() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<AdAdminKeywordPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const search = query.trim();

  useEffect(() => {
    if (search === debouncedQuery) return;
    const timer = setTimeout(() => setDebouncedQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search, debouncedQuery]);

  useEffect(() => {
    setData(null);
    setError('');
    setState('loading');
    if (search !== debouncedQuery) return;
    const controller = new AbortController();
    request.current = controller;
    const parameters = new URLSearchParams({ q: debouncedQuery, page: String(page) });
    void clientApiJson<AdAdminKeywordPage>(
      `${endpoint}?${parameters}`,
      { cache: 'no-store', signal: controller.signal },
      'Keyword list',
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
        setState('ready');
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        const denied = reason instanceof ApiError && [401, 403].includes(reason.status);
        setState(denied ? 'denied' : 'error');
        setError(
          denied
            ? 'Sign in with an admin wallet to view keywords.'
            : reason instanceof Error
              ? reason.message
              : 'Keywords could not be loaded.',
        );
      });
    return () => controller.abort();
  }, [search, debouncedQuery, page, refresh]);

  useEffect(() => {
    const authChanged = () => {
      request.current?.abort();
      setData(null);
      setRefresh((current) => current + 1);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, authChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, authChanged);
  }, []);

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section
      className="mb-[34px] border-y border-line py-5"
      aria-labelledby="keyword-market-keywords-heading"
    >
      <header className="flex items-center justify-between gap-5 max-sm:flex-col max-sm:items-stretch">
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Keyword list
          </span>
          <h2 className="my-1 text-[25px]" id="keyword-market-keywords-heading">
            Keywords
          </h2>
          <p className="m-0 text-sm text-muted">Total PRE stake across advertiser wallets.</p>
        </div>
        <ActionButton
          type="button"
          icon={
            state === 'loading' ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )
          }
          disabled={state === 'loading' || state === 'denied'}
          onClick={() => setRefresh((current) => current + 1)}
        >
          Refresh keywords
        </ActionButton>
      </header>
      <label className="mt-5 flex min-h-10 items-center gap-2 border border-line px-3">
        <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          aria-label="Search keywords"
          className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm outline-none"
          placeholder="Search keywords…"
          maxLength={64}
          value={query}
          disabled={state === 'denied'}
          onChange={(event) => {
            if (event.target.value.trim() !== search) {
              request.current?.abort();
              setData(null);
              setPage(1);
            }
            setQuery(event.target.value);
          }}
        />
      </label>
      {state === 'loading' ? (
        <p className="mt-4 mb-0 text-sm text-muted" role="status">
          Loading keywords…
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 mb-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {state === 'ready' && data?.chainStatus === 'SYNCING' ? (
        <p className="mt-4 mb-0 text-sm text-muted" role="status">
          Updating market data. Showing the latest indexed stakes.
        </p>
      ) : null}
      {state === 'ready' && data?.chainStatus === 'AWAITING_CONTRACT' ? (
        <p className="mt-4 mb-0 text-sm text-muted" role="status">
          Keyword Market contract is not configured. Stake amounts are unavailable.
        </p>
      ) : null}
      {state === 'ready' && data?.items.length === 0 ? (
        <p className="mt-4 mb-0 text-sm text-muted">
          {debouncedQuery ? 'No keywords match your search.' : 'No keywords yet.'}
        </p>
      ) : null}
      {state === 'ready' && data && data.items.length > 0 ? (
        <>
          <table className="mt-4 w-full table-fixed border-collapse text-left">
            <thead>
              <tr className="text-xs text-muted">
                <th className="w-2/3 pb-2 pr-4">Keyword</th>
                <th className="pb-2 text-right">Total PRE stake</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr className="border-t border-line" key={item.keyword}>
                  <td className="break-words py-3 pr-4">
                    <Link
                      className="inline-flex max-w-full items-center gap-1 text-sm font-bold text-blue"
                      href={`/keyword-market/keywords/${encodeURIComponent(item.keyword)}`}
                    >
                      <span className="min-w-0 break-words">{item.keyword}</span>
                      <ArrowUpRight size={12} className="shrink-0" aria-hidden="true" />
                    </Link>
                  </td>
                  <td className="break-words py-3 text-right font-mono text-sm">
                    {data.chainStatus === 'AWAITING_CONTRACT'
                      ? '—'
                      : `${formatPreAmount(item.stakeRaw)} PRE`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav
            className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted"
            aria-label="Keyword pagination"
          >
            <span>
              {data.total} keywords · Page {data.page} of {pageCount}
            </span>
            <div className="flex gap-2">
              <ActionButton
                type="button"
                size="compact"
                disabled={data.page <= 1}
                onClick={() => setPage(data.page - 1)}
              >
                Previous
              </ActionButton>
              <ActionButton
                type="button"
                size="compact"
                disabled={data.page >= pageCount}
                onClick={() => setPage(data.page + 1)}
              >
                Next
              </ActionButton>
            </div>
          </nav>
        </>
      ) : null}
    </section>
  );
}
