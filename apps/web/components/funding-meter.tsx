import type { FundingProgress } from '@precommunity/shared';
import { formatAmount } from '@/lib/format';

export function FundingMeter({
  item,
  compact = false,
}: {
  item: FundingProgress;
  compact?: boolean;
}) {
  const percent = Math.max(0, Math.min(100, item.percent));
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex justify-between gap-3 text-[11px]">
        <span className="font-mono text-blue">{item.asset}</span>
        <strong className="shrink-0 whitespace-nowrap font-mono text-right text-[11px]">
          {formatAmount(item.funded, item.asset)}{' '}
          <small className="text-[9px] text-muted">/ {formatAmount(item.target, item.asset)}</small>
        </strong>
      </div>
      <div
        className="h-1 overflow-hidden bg-line"
        role="progressbar"
        aria-label={`${item.asset} funding`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="block h-full bg-blue" style={{ width: `${percent}%` }} />
      </div>
      {!compact && item.surplus !== '0' ? (
        <p className="mt-1.5 text-[9px] text-muted">
          {formatAmount(item.surplus, item.asset)} confirmed above target
        </p>
      ) : null}
    </div>
  );
}
