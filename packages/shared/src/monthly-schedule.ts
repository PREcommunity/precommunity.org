const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export const MIN_FIRST_SETTLEMENT_DELAY_DAYS = 7;
export const MAX_FIRST_SETTLEMENT_DELAY_DAYS = 60;
export const MIN_FIRST_SETTLEMENT_DELAY_MS = MIN_FIRST_SETTLEMENT_DELAY_DAYS * MILLISECONDS_PER_DAY;
export const MAX_FIRST_SETTLEMENT_DELAY_MS = MAX_FIRST_SETTLEMENT_DELAY_DAYS * MILLISECONDS_PER_DAY;

function assertValidDate(date: Date, label: string) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RangeError(`${label} must be a valid date`);
  }
}

function isGregorianLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInUtcMonth(year: number, month: number) {
  if (month === 1) return isGregorianLeapYear(year) ? 29 : 28;
  if (month === 3 || month === 5 || month === 8 || month === 10) return 30;
  return 31;
}

function utcDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function isUtcMidnight(date: Date) {
  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

export function nextMonthlySettlementUtc(currentBoundary: Date, settlementDay: number): Date {
  assertValidDate(currentBoundary, 'Current monthly boundary');
  if (!isUtcMidnight(currentBoundary)) {
    throw new RangeError('Current monthly boundary must be at 00:00 UTC');
  }
  if (!Number.isInteger(settlementDay) || settlementDay < 1 || settlementDay > 31) {
    throw new RangeError('Monthly settlement day must be an integer from 1 to 31');
  }

  const currentMonth = currentBoundary.getUTCMonth();
  const nextMonth = (currentMonth + 1) % 12;
  const nextYear = currentBoundary.getUTCFullYear() + (currentMonth === 11 ? 1 : 0);
  const day = Math.min(settlementDay, daysInUtcMonth(nextYear, nextMonth));
  return utcDate(nextYear, nextMonth, day);
}

export function defaultFirstSettlementUtc(now = new Date()): Date {
  assertValidDate(now, 'Current time');
  const currentMonthStart = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return nextMonthlySettlementUtc(currentMonthStart, now.getUTCDate());
}
