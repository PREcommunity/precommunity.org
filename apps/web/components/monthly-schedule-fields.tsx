'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { defaultFirstSettlementUtc, nextMonthlySettlementUtc } from '@precommunity/shared';
import { formLabelTextClass, textInputClass } from './form-control-classes';

const DAY_MS = 24 * 60 * 60 * 1_000;

type DateFieldProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'data-validation-key'?: string;
};

function utcDateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function utcDateInputToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || utcDateValue(date) !== value
    ? undefined
    : date.toISOString();
}

export function monthlyOverrideDateBounds(now = new Date()) {
  const minimumInstant = new Date(now.getTime() + 7 * DAY_MS);
  const minimumMidnight = new Date(
    Date.UTC(
      minimumInstant.getUTCFullYear(),
      minimumInstant.getUTCMonth(),
      minimumInstant.getUTCDate(),
    ),
  );
  if (minimumMidnight.getTime() < minimumInstant.getTime()) {
    minimumMidnight.setUTCDate(minimumMidnight.getUTCDate() + 1);
  }

  const maximumInstant = new Date(now.getTime() + 60 * DAY_MS);
  const maximumMidnight = new Date(
    Date.UTC(
      maximumInstant.getUTCFullYear(),
      maximumInstant.getUTCMonth(),
      maximumInstant.getUTCDate(),
    ),
  );

  return { min: utcDateValue(minimumMidnight), max: utcDateValue(maximumMidnight) };
}

export function monthlyPeriodPreview(now = new Date(), firstSettlementDate?: string) {
  const overrideIso = firstSettlementDate ? utcDateInputToIso(firstSettlementDate) : undefined;
  const firstSettlement = overrideIso ? new Date(overrideIso) : defaultFirstSettlementUtc(now);
  const settlementDay = overrideIso ? firstSettlement.getUTCDate() : now.getUTCDate();
  const secondSettlement = nextMonthlySettlementUtc(firstSettlement, settlementDay);
  const thirdSettlement = nextMonthlySettlementUtc(secondSettlement, settlementDay);

  return {
    startsAt: now.toISOString(),
    endsAt: firstSettlement.toISOString(),
    settlementDay,
    settlementDates: [
      firstSettlement.toISOString(),
      secondSettlement.toISOString(),
      thirdSettlement.toISOString(),
    ],
  };
}

function formatUtcDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function MonthlyScheduleFields({
  dateFieldProps,
  dateError,
  initialFirstSettlementAt,
}: {
  dateFieldProps?: DateFieldProps;
  dateError?: ReactNode;
  initialFirstSettlementAt?: string | null;
}) {
  const initialCustomDate = initialFirstSettlementAt?.slice(0, 10) ?? '';
  const [custom, setCustom] = useState(Boolean(initialCustomDate));
  const [customDate, setCustomDate] = useState(initialCustomDate);
  const now = useMemo(() => new Date(), []);
  const bounds = useMemo(() => monthlyOverrideDateBounds(now), [now]);
  const preview = useMemo(
    () => monthlyPeriodPreview(now, custom && customDate ? customDate : undefined),
    [custom, customDate, now],
  );

  return (
    <fieldset className="col-span-full grid grid-cols-2 gap-3.5 border-y border-line py-4 max-sm:grid-cols-1">
      <legend className="sr-only">Monthly settlement schedule</legend>
      <input name="firstSettlementMode" type="hidden" value={custom ? 'CUSTOM' : 'DEFAULT'} />
      <div className="flex flex-col gap-2">
        <span className={formLabelTextClass}>First settlement</span>
        <strong className="text-sm">Same day next month</strong>
        <small className="max-w-[62ch] text-[10px] leading-4 text-muted">
          Funding opens immediately. The first period ends at 00:00 UTC and uses the full monthly
          target.
        </small>
        <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={custom}
            onChange={(event) => {
              setCustom(event.target.checked);
              if (!event.target.checked) setCustomDate('');
            }}
          />
          Choose a custom first settlement
        </label>
        {custom ? (
          <label className="mt-1 flex flex-col gap-1.5 motion-safe:animate-[row-rise_.2s_ease-out]">
            <span className={formLabelTextClass}>Custom date · 00:00 UTC</span>
            <input
              {...dateFieldProps}
              className={textInputClass}
              name="firstSettlementAt"
              type="date"
              min={bounds.min}
              max={bounds.max}
              value={customDate}
              onChange={(event) => setCustomDate(event.target.value)}
              required
            />
            {dateError}
            <small className="text-[10px] text-muted">
              Choose from {bounds.min} through {bounds.max}. The chosen day becomes the recurring
              base day.
            </small>
          </label>
        ) : null}
      </div>

      <div className="border-l border-line pl-4 max-sm:border-t max-sm:border-l-0 max-sm:pt-4 max-sm:pl-0">
        <span className={formLabelTextClass}>Settlement preview · UTC</span>
        <ol className="mt-2 mb-3 grid gap-1 font-mono text-xs">
          {preview.settlementDates.map((date, index) => (
            <li key={date}>
              {index + 1}. {formatUtcDate(date)} · 00:00
            </li>
          ))}
        </ol>
        <p className="m-0 text-[10px] leading-4 text-muted">
          Base day: {preview.settlementDay}. For days 29–31, shorter months use their final day and
          the next longer month returns to the base day. Settlement updates accounting; payout is a
          separate action.
        </p>
      </div>
    </fieldset>
  );
}
