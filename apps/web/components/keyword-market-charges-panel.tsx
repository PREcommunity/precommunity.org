'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { adChargeErrorMessage, type AdChargeBatchView } from '@precommunity/shared';
import { ExternalLink, LoaderCircle, Zap } from 'lucide-react';
import { formatUnits } from 'viem';
import { useKeywordMarketCharges } from '@/hooks/use-keyword-market-charges';
import { formatPreAmount, formatUtcTimestamp } from '@/lib/format';
import { ActionButton } from './action-button';
import { StatusNotice } from './status-notice';

function amount(raw: string | null, decimals = 18) {
  return raw === null ? '—' : formatUnits(BigInt(raw), decimals);
}

function preAmount(raw: string | null) {
  return raw === null ? '—' : formatPreAmount(raw);
}

function clickCount(raw: string | undefined) {
  return raw === undefined ? '—' : new Intl.NumberFormat('en').format(BigInt(raw));
}

function ChargeRow({ batch }: { batch: AdChargeBatchView }) {
  const error = adChargeErrorMessage(batch.errorCode);
  const explorer = batch.chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org';
  return (
    <tr className="border-t border-line align-top">
      <td className="py-3 pr-4 text-xs">
        <time dateTime={batch.createdAt}>{new Date(batch.createdAt).toLocaleString()}</time>
      </td>
      <td className="py-3 pr-4">
        <strong className="text-sm">{batch.keyword}</strong>
        <span className="mt-1 block font-mono text-[10px] text-muted" title={batch.stakerAddress}>
          {batch.stakerAddress.slice(0, 8)}…{batch.stakerAddress.slice(-6)} · stake v
          {batch.positionVersion}
        </span>
      </td>
      <td className="py-3 pr-4 font-mono text-xs">{batch.clickCount}</td>
      <td className="py-3 pr-4 font-mono text-xs">
        {preAmount(batch.requestedPreRaw)}
        {batch.duePreRaw !== batch.requestedPreRaw ? (
          <span className="mt-1 block text-muted">Due: {preAmount(batch.duePreRaw)}</span>
        ) : null}
      </td>
      <td className="py-3 pr-4 font-mono text-xs">
        {preAmount(batch.chargedPreRaw)}
        {batch.shortfallPreRaw && BigInt(batch.shortfallPreRaw) > 0n ? (
          <span className="mt-1 block text-danger">
            Uncollected: {preAmount(batch.shortfallPreRaw)}
          </span>
        ) : null}
      </td>
      <td className="max-w-[300px] py-3 text-xs">
        <strong>{batch.status.replaceAll('_', ' ')}</strong>
        {error ? <p className="mt-1 mb-0 text-danger">{error}</p> : null}
        {batch.txHash ? (
          <a
            className="mt-1 inline-flex items-center gap-1 text-blue"
            href={`${explorer}/tx/${batch.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Transaction <ExternalLink size={12} />
          </a>
        ) : null}
      </td>
    </tr>
  );
}

export function KeywordMarketChargesPanel({ canManage }: { canManage: boolean }) {
  const charges = useKeywordMarketCharges(canManage);
  const view = charges.view;
  const clickTotals = view?.clickTotals;
  const [automaticEnabled, setAutomaticEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState('10');
  const [clickThreshold, setClickThreshold] = useState('50');
  const enabled = view?.settings.automaticEnabled;
  const interval = view?.settings.intervalMinutes;
  const threshold = view?.settings.clickThreshold;

  useEffect(() => {
    if (enabled === undefined || interval === undefined || threshold === undefined) return;
    setAutomaticEnabled(enabled);
    setIntervalMinutes(String(interval));
    setClickThreshold(String(threshold));
  }, [enabled, interval, threshold]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void charges.save({
      automaticEnabled,
      intervalMinutes: Number(intervalMinutes),
      clickThreshold: Number(clickThreshold),
    });
  }

  const readiness = view?.readiness;
  const blocked = readiness?.status !== 'READY';
  const readinessMessage = adChargeErrorMessage(readiness?.errorCode);
  const runError = adChargeErrorMessage(view?.latestRun?.errorCode);

  return (
    <section
      className="mb-[34px] border-y border-line py-5"
      aria-labelledby="keyword-market-charges-heading"
    >
      <header className="flex items-center justify-between gap-5 max-sm:flex-col max-sm:items-stretch">
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Stake billing
          </span>
          <h2 className="my-1 text-[25px]" id="keyword-market-charges-heading">
            Charges
          </h2>
          <p className="m-0 text-sm text-muted">
            Settle recorded clicks from each advertiser’s PRE stake.
          </p>
        </div>
        {canManage ? (
          <ActionButton
            type="button"
            icon={
              charges.pending ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <Zap size={15} />
              )
            }
            disabled={charges.loading || charges.pending || blocked}
            onClick={() => void charges.run()}
          >
            {charges.pending
              ? charges.runState === 'RUNNING'
                ? 'Charging…'
                : 'Waiting for worker…'
              : 'Charge now'}
          </ActionButton>
        ) : null}
      </header>
      <dl className="mt-5 mb-0 grid grid-cols-2 gap-5 border-t border-line pt-4">
        <div>
          <dt className="text-xs text-muted">Billable clicks</dt>
          <dd className="m-0 mt-1 break-words font-mono font-bold">
            {clickCount(clickTotals?.billableClicks)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Non-billable: 5-minute limit</dt>
          <dd className="m-0 mt-1 break-words font-mono font-bold">
            {clickCount(clickTotals?.suppressedClicks)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 mb-0 text-xs text-muted">
        Each valid ad link counts at most once in these totals. Billable clicks include those
        awaiting a price or settlement.
        {clickTotals?.startedAt ? (
          <span className="mt-1 block">
            Since{' '}
            <time dateTime={clickTotals.startedAt}>
              {formatUtcTimestamp(clickTotals.startedAt)}
            </time>
          </span>
        ) : clickTotals ? (
          <span className="mt-1 block">Counting starts with the first recorded click.</span>
        ) : null}
      </p>
      <dl className="mt-5 mb-0 grid grid-cols-2 gap-5 border-t border-line pt-4 md:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Pending clicks</dt>
          <dd className="m-0 mt-1 font-mono font-bold">{view?.pending.clicks ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Pending PRE</dt>
          <dd className="m-0 mt-1 break-words font-mono font-bold">
            {view ? preAmount(view.pending.preRaw) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">USD awaiting a price</dt>
          <dd className="m-0 mt-1 break-words font-mono font-bold">
            {view ? amount(view.pending.usdRaw, 6) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Worker</dt>
          <dd className={`m-0 mt-1 text-sm font-bold ${blocked ? 'text-danger' : ''}`}>
            {charges.loading
              ? 'Loading…'
              : readiness
                ? {
                    READY: 'Ready',
                    BLOCKED: 'Blocked',
                    WORKER_UNAVAILABLE: 'Unavailable',
                    WAITING_CONFIRMATION: 'Waiting for confirmation',
                  }[readiness.status]
                : 'Unavailable'}
          </dd>
        </div>
      </dl>
      {readinessMessage ? (
        <p className="mt-3 mb-0 text-xs text-danger" role="status">
          {readinessMessage}
        </p>
      ) : null}
      {view && view.pending.awaitingPriceClicks > 0 ? (
        <p className="mt-3 mb-0 text-xs text-muted">
          {view.pending.awaitingPriceClicks}{' '}
          {view.pending.awaitingPriceClicks === 1 ? 'click awaits' : 'clicks await'} a current
          PRE/USD quote. Recorded PRE amounts can still be charged.
        </p>
      ) : null}
      {view && view.pending.captureErrors > 0 ? (
        <p className="mt-3 mb-0 text-xs text-danger">
          {view.pending.captureErrors} clicks could not capture a billing bid and will not be
          charged.
        </p>
      ) : null}
      {readiness?.signerAddress ? (
        <p className="mt-3 mb-0 break-all text-xs text-muted">
          Operator wallet: <span className="font-mono">{readiness.signerAddress}</span>
          {readiness.gasBalanceRaw !== null
            ? ` · ${amount(readiness.gasBalanceRaw)} ETH available for fees`
            : ''}
        </p>
      ) : null}
      <form
        className="mt-5 flex flex-wrap items-end gap-4 border-t border-line pt-4"
        onSubmit={save}
      >
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={automaticEnabled}
            disabled={!canManage || charges.loading || charges.saving || !view?.contractAddress}
            onChange={(event) => setAutomaticEnabled(event.target.checked)}
          />{' '}
          Automatic charges
        </label>
        <label className="text-xs text-muted">
          Interval (minutes)
          <input
            className="mt-1 block min-h-9 w-32 rounded border border-line bg-white px-2 text-sm text-navy"
            type="number"
            required
            min="1"
            max="2147483647"
            step="1"
            value={intervalMinutes}
            disabled={!canManage || charges.loading || charges.saving || !view?.contractAddress}
            onChange={(event) => setIntervalMinutes(event.target.value)}
          />
        </label>
        <label className="text-xs text-muted">
          Clicks per stake
          <input
            className="mt-1 block min-h-9 w-32 rounded border border-line bg-white px-2 text-sm text-navy"
            type="number"
            required
            min="1"
            max="2147483647"
            step="1"
            value={clickThreshold}
            disabled={!canManage || charges.loading || charges.saving || !view?.contractAddress}
            onChange={(event) => setClickThreshold(event.target.value)}
          />
        </label>
        {canManage ? (
          <ActionButton
            type="submit"
            disabled={charges.loading || charges.saving || !view?.contractAddress}
          >
            {charges.saving ? 'Saving…' : 'Save settings'}
          </ActionButton>
        ) : null}
      </form>
      <p className="mt-2 mb-0 text-xs text-muted">
        Automatic charges run when either trigger is reached for a stake. “Charge now” also settles
        stakes below these thresholds.
      </p>
      {!canManage ? (
        <p className="mt-2 mb-0 text-xs text-muted">
          Only SUPER_ADMIN can change settings or charge stakes.
        </p>
      ) : null}
      {view?.latestRun ? (
        <p className="mt-4 mb-0 text-xs">
          Latest routine: <strong>{view.latestRun.status.replaceAll('_', ' ')}</strong> ·{' '}
          {view.latestRun.trigger === 'MANUAL' ? 'Manual' : 'Automatic'}
          {runError ? <span className="mt-1 block text-danger">{runError}</span> : null}
        </p>
      ) : null}
      <StatusNotice notice={charges.notice} />
      <h3 className="mt-5 mb-3 text-base">Recent charges</h3>
      {view?.history.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[740px] border-collapse text-left">
            <thead>
              <tr className="text-xs text-muted">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Keyword / stake</th>
                <th className="pb-2 pr-4">Clicks</th>
                <th className="pb-2 pr-4">Requested PRE</th>
                <th className="pb-2 pr-4">Charged PRE</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.history.map((batch) => (
                <ChargeRow key={batch.id} batch={batch} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">
          {charges.loading
            ? 'Loading charge history…'
            : view
              ? 'No charges recorded yet.'
              : 'Charge history is unavailable.'}
        </p>
      )}
      {view?.nextCursor ? (
        <ActionButton
          className="mt-3"
          type="button"
          disabled={charges.loadingMore}
          onClick={() => void charges.more()}
        >
          {charges.loadingMore ? 'Loading…' : 'Load more charges'}
        </ActionButton>
      ) : null}
    </section>
  );
}
