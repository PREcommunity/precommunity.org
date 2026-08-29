import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, CircleAlert, CircleX, Clock3 } from 'lucide-react';
import type { GoalSummary } from '@precommunity/shared';
import { formatDeadline, statusLabel } from '@/lib/format';
import { FundingMeter } from './funding-meter';

export function GoalList({ goals, month }: { goals: GoalSummary[]; month: string }) {
  if (goals.length === 0) {
    return (
      <div className="border-y border-line py-7">
        <span aria-hidden="true">000</span>
        <div>
          <strong className="text-lg">No goals yet.</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="border-t border-navy">
      <div
        className="grid grid-cols-[minmax(240px,1fr)_minmax(200px,300px)_140px] gap-4 border-b border-line pt-2 pb-2 pl-10 font-mono text-[10px] text-muted uppercase max-[900px]:hidden"
        aria-hidden="true"
      >
        <span>Goal</span>
        <span>Funding</span>
        <span>Proof</span>
      </div>
      {goals.map((goal, index) => (
        <Link
          href={`/goals/${goal.slug}?month=${encodeURIComponent(month)}`}
          className="group grid grid-cols-[24px_minmax(240px,1fr)_minmax(200px,300px)_140px] items-center gap-4 border-b border-line py-3.5 transition-[padding] duration-180 hover:px-2.5 max-[900px]:grid-cols-[24px_minmax(0,1fr)] max-[900px]:gap-x-3 max-sm:grid-cols-[20px_minmax(0,1fr)] max-sm:gap-2 motion-safe:[animation:row-rise_.45s_var(--row-delay)_cubic-bezier(.16,1,.3,1)_both]"
          key={goal.id}
          aria-label={`View ${goal.title}`}
          style={{ '--row-delay': `${index * 65}ms` } as React.CSSProperties}
        >
          <span className="font-mono text-[10px] text-blue">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="flex min-w-0 flex-col">
            <small className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-muted">
              {goal.subproject?.name ?? 'On-chain goal'} ·{' '}
              {goal.monthly
                ? `period #${goal.monthly.selectedPeriod.periodIndex} ends ${formatDeadline(goal.monthly.selectedPeriod.endsAt)}`
                : `closes ${formatDeadline(goal.deadline)}`}
            </small>
            <strong className="my-[3px] text-[15px]">{goal.title}</strong>
            <span className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-muted max-sm:whitespace-normal">
              {goal.description || 'No description.'}
            </span>
          </span>
          <span className="flex flex-col gap-2 max-[900px]:col-start-2 max-[900px]:row-start-2">
            {goal.progress.map((item) => (
              <FundingMeter key={item.asset} item={item} compact />
            ))}
          </span>
          <span className="flex items-center justify-end gap-1.5 text-[11px] text-muted max-[900px]:col-start-2 max-[900px]:row-start-3 max-[900px]:justify-start">
            {(goal.monthly?.phase ?? goal.status) === 'ACTIVE' ||
            (goal.monthly?.phase ?? goal.status) === 'OPEN' ? (
              <i className="size-1.5 rounded-full bg-blue" aria-hidden="true" />
            ) : goal.status === 'CLOSED' || goal.status === 'CANCELLED' ? (
              <CircleX className="text-danger" size={14} aria-hidden="true" />
            ) : goal.status === 'SETTLED' ? (
              <CheckCircle2 className="text-success" size={14} aria-hidden="true" />
            ) : goal.status === 'EXPIRED' ? (
              <Clock3 className="text-warning" size={14} aria-hidden="true" />
            ) : (
              <CircleAlert className="text-warning" size={14} aria-hidden="true" />
            )}
            {goal.monthly ? goal.monthly.phase.replaceAll('_', ' ') : statusLabel(goal.status)}
            <ArrowUpRight
              className="shrink-0 transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1"
              size={17}
            />
          </span>
        </Link>
      ))}
    </div>
  );
}
