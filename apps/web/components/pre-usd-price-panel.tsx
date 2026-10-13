'use client';

import { ArrowUpRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { formatUnits } from 'viem';
import { usePreUsdPrice } from '@/hooks/use-pre-usd-price';
import { ActionButton } from './action-button';
import { StatusNotice } from './status-notice';
import { preUsdPublicationErrorMessage } from '@precommunity/shared';

export function PreUsdPricePanel({ canRefresh }: { canRefresh: boolean }) {
  const price = usePreUsdPrice(canRefresh);
  const quote = price.view?.quote;
  const contract = price.view?.contract;
  const publication = contract?.publication;
  const stateLabel = price.loading
    ? 'Loading…'
    : price.view
      ? { FRESH: 'Current', STALE: 'Out of date', MISSING: 'No quote' }[price.view.status]
      : 'Unavailable';

  return (
    <section
      className="mb-[34px] border-y border-line py-5"
      aria-labelledby="pre-usd-price-heading"
    >
      <header className="flex items-center justify-between gap-5 max-sm:flex-col max-sm:items-stretch">
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Market price
          </span>
          <h2 className="my-1 text-[25px]" id="pre-usd-price-heading">
            PRE / USD
          </h2>
          <p className="m-0 text-sm text-muted">
            CoinGecko · checked every 10 minutes · the last contract price sets stake limits and
            click costs
          </p>
        </div>
        {canRefresh ? (
          <ActionButton
            type="button"
            icon={
              price.pending ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )
            }
            disabled={
              price.loading || price.pending || price.cooldown || !price.view?.collectorEnabled
            }
            onClick={() => void price.refresh()}
          >
            {price.pending
              ? price.refreshState === 'RUNNING'
                ? 'Updating price…'
                : 'Waiting for worker…'
              : 'Refresh price'}
          </ActionButton>
        ) : null}
      </header>
      <dl className="mt-5 mb-0 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 md:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">CoinGecko price per 1 PRE</dt>
          <dd className="m-0 mt-1 break-words font-mono text-lg font-bold">
            {quote ? `${quote.priceUsd} USD` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Quote status</dt>
          <dd
            className={`m-0 mt-1 text-sm font-bold ${price.view?.status === 'STALE' ? 'text-danger' : ''}`}
          >
            {stateLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Quote updated</dt>
          <dd className="m-0 mt-1 text-sm">
            {quote ? (
              <time dateTime={quote.quotedAt}>{new Date(quote.quotedAt).toLocaleString()}</time>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Last collected</dt>
          <dd className="m-0 mt-1 text-sm">
            {quote ? (
              <time dateTime={quote.fetchedAt}>{new Date(quote.fetchedAt).toLocaleString()}</time>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>
      {contract ? (
        <dl className="mt-5 mb-0 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 md:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Contract price per 1 PRE</dt>
            <dd className="m-0 mt-1 break-words font-mono text-lg font-bold">
              {contract.priceUsd ? `${contract.priceUsd} USD` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Contract quote status</dt>
            <dd className="m-0 mt-1 text-sm font-bold">
              {
                {
                  FRESH: 'Current',
                  STALE: 'Older quote · still in use',
                  MISSING: 'No quote',
                  SYNCING: 'Waiting for chain index',
                  AWAITING_CONTRACT: 'Not configured',
                }[contract.status]
              }
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Contract quote updated</dt>
            <dd className="m-0 mt-1 text-sm">
              {contract.quotedAt ? (
                <time dateTime={contract.quotedAt}>
                  {new Date(contract.quotedAt).toLocaleString()}
                </time>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Publication</dt>
            <dd className="m-0 mt-1 text-sm">
              {publication ? publication.status.replaceAll('_', ' ') : 'No publication yet'}
              {publication?.txHash ? (
                <a
                  className="mt-1 flex w-fit items-center gap-1 text-blue"
                  href={`${contract.chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org'}/tx/${publication.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <ArrowUpRight size={12} aria-hidden="true" />
                </a>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : null}
      {contract?.updaterAddress && !/^0x0{40}$/i.test(contract.updaterAddress) ? (
        <p className="mt-3 mb-0 break-all text-xs text-muted">
          Price updater wallet: <span className="font-mono">{contract.updaterAddress}</span>
          {contract.updaterGasBalanceRaw
            ? ` · ${formatUnits(BigInt(contract.updaterGasBalanceRaw), 18)} ETH available for fees`
            : ' · ETH balance unavailable'}
        </p>
      ) : null}
      {publication?.errorCode ? (
        <p className="mt-3 mb-0 text-xs text-danger" role="status">
          {preUsdPublicationErrorMessage(publication.errorCode)}
        </p>
      ) : null}
      {price.view?.status === 'STALE' ? (
        <p className="mt-3 mb-0 text-xs text-danger">
          The last recorded price is shown. A current quote is not available.
        </p>
      ) : null}
      {price.view && !price.view.collectorEnabled ? (
        <p className="mt-3 mb-0 text-xs text-muted">
          Price updates are not configured. Contact the operator to enable them.
        </p>
      ) : null}
      {!canRefresh ? (
        <p className="mt-3 mb-0 text-xs text-muted">Only SUPER_ADMIN can refresh the price.</p>
      ) : null}
      <StatusNotice notice={price.notice} />
    </section>
  );
}
