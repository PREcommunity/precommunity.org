import { ArrowDown, ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContributionPanel } from '@/components/contribution-panel';
import { GoalContributions } from '@/components/goal-contributions';
import { FundingMeter } from '@/components/funding-meter';
import { getGoal, getGoalContributions, getGoalPeriods } from '@/lib/api';
import { MonthlyGoalPanel } from '@/components/monthly-goal-panel';
import {
  formatAmount,
  formatDeadline,
  formatUtcTimestamp,
  shortAddress,
  statusLabel,
} from '@/lib/format';
import { ShareLinks } from '@/components/share-links';
import {
  activeDeployment,
  activeExplorerAddress,
  activeExplorerTransaction,
} from '@/lib/deployment';

export default async function GoalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const goal = await getGoal(slug, query.month);
  if (!goal) notFound();
  const [contributions, periods] = await Promise.all([
    getGoalContributions(slug),
    goal.goalType === 'MONTHLY' ? getGoalPeriods(slug) : Promise.resolve(null),
  ]);
  const transactionUrl = activeExplorerTransaction(goal.creationTxHash);
  const hasSupportingMaterial = Boolean(
    goal.discussionUrl || goal.metadataUri || goal.documents.length,
  );
  return (
    <main className="page-gutter pt-7 pb-[60px]">
      <Link
        href={
          query.month ? `/funding?month=${encodeURIComponent(query.month)}#goals` : '/funding#goals'
        }
        className="inline-flex items-center gap-1.5 text-xs text-blue"
      >
        <ArrowLeft size={16} /> Back to verified goals
      </Link>
      <section className="py-9">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
              Confirmed balances
            </span>
            <h2 className="mt-1.5 text-2xl leading-[1.15] tracking-[-.025em]">Funding progress</h2>
          </div>
          {goal.status === 'OPEN' ? (
            <a
              className="ml-auto inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-navy bg-navy px-4 font-bold text-white transition-colors duration-150 hover:border-blue hover:bg-blue hover:text-navy dark:hover:bg-blue-soft dark:hover:text-white"
              href="#contribute"
            >
              Contribute <ArrowDown size={16} aria-hidden="true" />
            </a>
          ) : null}
        </header>
        <div className="grid grid-cols-2 gap-8 max-sm:grid-cols-1">
          {goal.progress.map((item) => (
            <FundingMeter item={item} key={item.asset} />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_260px] items-end gap-10 border-b border-navy py-7 max-[900px]:grid-cols-1">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            {goal.subproject?.name ?? activeDeployment.networkName} · {statusLabel(goal.status)}
          </span>
          <h1 className="mt-2.5 mb-2 text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-.04em]">
            {goal.title}
          </h1>
          <p className="m-0 max-w-[760px] whitespace-pre-wrap text-muted">
            {goal.description || 'No description.'}
          </p>
          {goal.discussionUrl ? (
            <a
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-navy bg-white px-4 font-bold transition-colors duration-150 hover:border-blue hover:bg-blue-soft"
              href={goal.discussionUrl}
              target="_blank"
              rel="noreferrer"
            >
              Forum discussion <ExternalLink size={15} aria-hidden="true" />
            </a>
          ) : null}
          <ShareLinks kind="goal" title={goal.title} />
        </div>
        <a
          href={transactionUrl}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col gap-3 border border-line bg-white p-[18px]"
        >
          <span className="text-[10px] text-muted uppercase">Creation proof</span>
          <strong>Block {goal.creationBlock}</strong>
          <small className="flex justify-between font-mono">
            {shortAddress(goal.creationTxHash)} <ExternalLink size={13} />
          </small>
        </a>
      </section>

      <section className="grid grid-cols-4 border-b border-line max-sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 border-r border-line py-[13px] pr-4 first:pl-0 last:border-0 max-sm:border-r-0 max-sm:border-b max-sm:py-2.5">
          <small className="text-[9px] text-muted uppercase">
            {goal.goalType === 'MONTHLY' ? 'Selected period end · UTC' : 'Deadline · UTC'}
          </small>
          <strong className="text-xs">
            {formatDeadline(goal.monthly?.selectedPeriod.endsAt ?? goal.deadline)}
          </strong>
        </div>
        <div className="flex flex-col gap-1.5 border-r border-line px-4 py-[13px] max-sm:border-r-0 max-sm:border-b max-sm:px-0 max-sm:py-2.5">
          <small className="text-[9px] text-muted uppercase">Recipient</small>
          <a
            className="font-mono text-xs text-blue transition-transform duration-150 hover:translate-x-0.5"
            href={activeExplorerAddress(goal.recipientAddress)}
            target="_blank"
            rel="noreferrer"
            title={goal.recipientAddress}
          >
            {shortAddress(goal.recipientAddress)} <ExternalLink className="inline" size={13} />
          </a>
        </div>
        <div className="flex flex-col gap-1.5 border-r border-line px-4 py-[13px] max-sm:border-r-0 max-sm:border-b max-sm:px-0 max-sm:py-2.5">
          <small className="text-[9px] text-muted uppercase">Goal ID</small>
          <strong className="font-mono text-xs" title={goal.chainGoalId}>
            {shortAddress(goal.chainGoalId)}
          </strong>
        </div>
        <div className="flex flex-col gap-1.5 px-4 py-[13px] max-sm:px-0 max-sm:py-2.5">
          <small className="text-[9px] text-muted uppercase">Metadata</small>
          <strong className="text-xs">
            {goal.metadataStatus.replaceAll('_', ' ').toLowerCase()}
          </strong>
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-10 py-9 max-[900px]:grid-cols-1">
        <GoalContributions slug={slug} initialPage={contributions} />
        {goal.status === 'SETTLED' ? (
          <aside
            className="border border-line bg-white p-[18px]"
            aria-labelledby="funds-released-title"
          >
            <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
              Funds released
            </span>
            <h2 className="my-1 text-[22px]" id="funds-released-title">
              Funds have been sent
            </h2>
            <p className="m-0 text-xs text-muted">
              All confirmed funds for this goal have been transferred. This goal no longer accepts
              contributions.
            </p>
            {goal.payouts?.length ? (
              <div className="mt-4 border-t border-line">
                {goal.payouts.map((payout) => (
                  <div
                    className="border-b border-line py-3 text-xs"
                    key={`${payout.transactionUrl}-${payout.asset}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong>{formatAmount(payout.amount, payout.asset)}</strong>
                      <time className="text-[10px] text-muted">
                        {formatUtcTimestamp(payout.executedAt)}
                      </time>
                    </div>
                    <dl className="mt-2 grid gap-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted">Recipient</dt>
                        <dd className="m-0 font-mono text-[10px]" title={payout.recipientAddress}>
                          {shortAddress(payout.recipientAddress)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted">Transaction</dt>
                        <dd className="m-0">
                          <a
                            className="inline-flex items-center gap-1 text-blue transition-transform duration-150 hover:translate-x-0.5"
                            href={payout.transactionUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View on BaseScan <ExternalLink size={13} />
                          </a>
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : null}
          </aside>
        ) : (
          <ContributionPanel goal={goal} />
        )}
      </div>

      {goal.monthly && periods ? <MonthlyGoalPanel goal={goal} periods={periods} /> : null}

      {hasSupportingMaterial ? (
        <section className="border-t border-line py-9">
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Optional context
          </span>
          <h2 className="mt-1.5 text-2xl leading-[1.15] tracking-[-.025em]">Supporting material</h2>
          <p className="m-0 text-muted">Links attached to this goal.</p>
          <div className="mt-4 flex flex-wrap gap-3.5">
            {goal.discussionUrl ? (
              <a
                className="inline-flex items-center gap-1.5 text-xs text-blue"
                href={goal.discussionUrl}
                target="_blank"
                rel="noreferrer"
              >
                Community discussion <ExternalLink size={14} />
              </a>
            ) : null}
            {goal.metadataUri ? (
              <a
                className="inline-flex items-center gap-1.5 text-xs text-blue"
                href={`https://ipfs.io/ipfs/${goal.metadataUri.slice(7)}`}
                target="_blank"
                rel="noreferrer"
              >
                IPFS reference <ExternalLink size={14} />
              </a>
            ) : null}
            {goal.documents.map((document) => (
              <a
                className="inline-flex items-center gap-1.5 text-xs text-blue"
                href={document.url}
                target="_blank"
                rel="noreferrer"
                key={`${document.label}-${document.url}`}
              >
                {document.label} <ExternalLink size={14} />
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
