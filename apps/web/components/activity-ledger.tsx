import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { DashboardResponse } from '@precommunity/shared';
import { formatAmount, formatUtcTimestamp } from '@/lib/format';

export function ActivityLedger({ activity }: { activity: DashboardResponse['activity'] }) {
  if (activity.length === 0)
    return <p className="m-0 border-y border-line py-6 text-muted">No activity yet.</p>;
  return (
    <div className="border-t border-navy">
      {activity.map((item, index) => (
        <div
          className="group relative grid min-h-[58px] grid-cols-[24px_30px_minmax(160px,1fr)_auto] items-center gap-2.5 border-b border-line transition-[padding] duration-180 hover:px-2.5 max-sm:grid-cols-[20px_26px_1fr] max-sm:py-2.5"
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
              aria-label="Open transaction proof on BaseScan"
            />
          )}
          <span className="pointer-events-none relative z-10 font-mono text-[10px] text-blue">
            {String(index + 1).padStart(2, '0')}
          </span>
          {item.sponsorAvatarUrl ? (
            <img
              className="pointer-events-none relative z-10 size-[26px] rounded-full object-cover"
              src={item.sponsorAvatarUrl}
              alt=""
            />
          ) : (
            <span
              className={`pointer-events-none relative z-10 grid size-[26px] place-items-center rounded-full font-mono ${item.kind === 'CONTRIBUTION' ? 'bg-blue' : 'bg-navy text-white'}`}
            >
              {item.kind === 'CONTRIBUTION' ? '+' : '↗'}
            </span>
          )}
          <span className="pointer-events-none relative z-10 flex flex-col">
            <strong>{item.label}</strong>
            <small className="text-[10px] text-muted">{formatUtcTimestamp(item.occurredAt)}</small>
          </span>
          <span className="pointer-events-none relative z-10 flex items-center gap-[7px] font-mono text-xs max-sm:col-start-3">
            {formatAmount(item.amount, item.asset)}
            <a
              className="pointer-events-auto text-blue"
              href={item.transactionUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open transaction proof on BaseScan"
            >
              <ExternalLink
                className="transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1"
                size={13}
              />
            </a>
          </span>
        </div>
      ))}
    </div>
  );
}
