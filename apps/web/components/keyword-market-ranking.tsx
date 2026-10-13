'use client';

import {
  BASE_MAINNET_DEPLOYMENT,
  BASE_SEPOLIA_DEPLOYMENT,
  explorerTransactionUrl,
  type AdKeywordResponse,
} from '@precommunity/shared';
import { ArrowUpRight, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { formatPreAmount } from '@/lib/format';
import { ActionButton } from './action-button';

const PAGE_SIZE = 20;

export function KeywordMarketRanking({
  data,
  editHref,
}: {
  data: AdKeywordResponse;
  editHref?: string;
}) {
  const [page, setPage] = useState(1);
  const { sessionAddress } = useWalletSession();
  const deployment = [BASE_MAINNET_DEPLOYMENT, BASE_SEPOLIA_DEPLOYMENT].find(
    (network) => network.chainId === data.chainId,
  );
  const pageCount = Math.max(1, Math.ceil(data.positions.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visiblePositions = data.positions.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <>
      <div className="overflow-x-auto">
        <section
          className="keyword-market-ledger keyword-market-ranking-ledger"
          aria-label={`USD bid ranking for ${data.keyword}`}
        >
          <div className="keyword-market-ledger-head">
            <span>Rank / staker</span>
            <span>Bid per click</span>
            <span>PRE stake</span>
            <span>Proof</span>
            <span>Eligible</span>
            <span className="text-right">Actions</span>
          </div>
          {visiblePositions.map((position, index) => (
            <div
              className="keyword-market-ledger-row"
              key={position.stakerAddress}
              style={{ '--keyword-market-row-index': index } as React.CSSProperties}
            >
              <span className="keyword-market-ledger-keyword">
                <small className="shrink-0">{position.eligible ? `#${position.rank}` : '—'}</small>
                <span className="block min-w-0">
                  <span className="flex items-baseline gap-2">
                    <strong title={position.stakerAddress}>
                      {position.stakerAddress.slice(0, 8)}…{position.stakerAddress.slice(-6)}
                    </strong>
                    {sessionAddress?.toLowerCase() === position.stakerAddress.toLowerCase() ? (
                      <span className="shrink-0 text-xs text-blue">(you)</span>
                    ) : null}
                  </span>
                </span>
              </span>
              <span>
                <strong>${formatUnits(BigInt(position.bidUsdRaw), 6)}</strong>
                <small>USD / click</small>
              </span>
              <span>
                <strong>{formatPreAmount(position.stakeRaw)}</strong>
                <small>PRE</small>
              </span>
              <span>
                <strong>{position.positionBlock}</strong>
                <small title={position.positionTxHash}>
                  {deployment ? (
                    <a
                      className="keyword-market-text-link"
                      href={explorerTransactionUrl(position.positionTxHash, deployment)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View transaction ${position.positionTxHash} in block explorer (opens in a new tab)`}
                    >
                      {position.positionTxHash.slice(0, 12)}…
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                  ) : (
                    <>{position.positionTxHash.slice(0, 12)}…</>
                  )}
                </small>
              </span>
              <span
                className={`keyword-market-status ${position.eligible && position.hasEligibleAd ? 'keyword-market-status-success' : 'keyword-market-status-muted'}`}
              >
                {!position.eligible
                  ? position.withdrawAvailableAt !== '0'
                    ? 'Withdrawing'
                    : 'Needs PRE'
                  : position.hasEligibleAd
                    ? 'Eligible'
                    : 'No approved ad'}
              </span>
              <span className="items-end">
                {editHref &&
                sessionAddress?.toLowerCase() === position.stakerAddress.toLowerCase() ? (
                  <Link
                    className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-navy bg-white px-2.5 text-[10px] font-bold text-navy transition-colors hover:border-blue hover:bg-blue-soft"
                    href={editHref}
                  >
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </Link>
                ) : null}
              </span>
            </div>
          ))}
        </section>
      </div>
      {pageCount > 1 ? (
        <nav className="keyword-market-campaign-pagination" aria-label="Ranking pagination">
          <ActionButton
            size="compact"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </ActionButton>
          <span aria-live="polite">
            Page {currentPage} of {pageCount} · {pageStart + 1}–
            {pageStart + visiblePositions.length} of {data.positions.length} positions
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
  );
}
