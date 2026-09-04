'use client';

import { useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import type { GoalContributionsPage } from '@precommunity/shared';
import { getGoalContributions } from '@/lib/api';
import { formatAmount, formatUtcTimestamp } from '@/lib/format';

export function GoalContributions({
  slug,
  initialPage,
}: {
  slug: string;
  initialPage: GoalContributionsPage;
}) {
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const page = await getGoalContributions(slug, cursor);
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setError('More confirmed contributions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="min-w-0" aria-labelledby="goal-contributions-title">
      <header className="mb-5">
        <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
          Confirmed on Base
        </span>
        <h2
          className="mt-1.5 text-2xl leading-[1.15] tracking-[-.025em]"
          id="goal-contributions-title"
        >
          Contributions
        </h2>
      </header>
      {items.length ? (
        <div className="border-t border-line">
          {items.map((item) => (
            <article
              className="group relative grid min-h-[62px] grid-cols-[minmax(180px,1fr)_auto] items-center gap-2.5 border-b border-line transition-[padding] duration-180 hover:px-2.5 max-sm:grid-cols-1 max-sm:py-2.5"
              key={item.id}
            >
              {item.sponsorUrl ? (
                <Link
                  className="absolute inset-0"
                  href={item.sponsorUrl}
                  aria-label={`View ${item.label}'s profile`}
                />
              ) : (
                <a
                  className="absolute inset-0"
                  href={item.transactionUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open contribution on BaseScan"
                />
              )}
              <div className="pointer-events-none relative z-10 flex flex-col">
                <strong>{item.label}</strong>
                <small className="text-[10px] text-muted">
                  {formatUtcTimestamp(item.occurredAt)} · block {item.blockNumber}
                </small>
              </div>
              <span className="pointer-events-none relative z-10 flex items-center gap-[7px] font-mono text-xs">
                {formatAmount(item.amount, item.asset)}
                <a
                  className="pointer-events-auto text-blue"
                  href={item.transactionUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open contribution on BaseScan"
                >
                  <ExternalLink
                    className="transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1"
                    size={13}
                  />
                </a>
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="m-0 border-y border-line py-6 text-muted">No confirmed contributions yet.</p>
      )}
      {cursor ? (
        <button
          type="button"
          className="mt-4 inline-flex min-h-9 items-center justify-center gap-1.5 rounded border border-navy bg-white px-3 font-bold hover:bg-blue-soft disabled:cursor-not-allowed disabled:opacity-55"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? <LoaderCircle className="animate-spin" size={15} /> : null}
          {loading ? 'Loading…' : 'Load more contributions'}
        </button>
      ) : null}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
