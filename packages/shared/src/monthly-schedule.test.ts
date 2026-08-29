import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultFirstSettlementUtc,
  isUtcMidnight,
  nextMonthlySettlementUtc,
} from './monthly-schedule';

type MonthlyScheduleVector = {
  boundary: string;
  settlementDay: number;
  expected: string;
};

const fixturePath = resolve(__dirname, 'monthly-schedule-vectors.json');
const monthlyScheduleVectors = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as MonthlyScheduleVector[];

describe('monthly UTC schedule', () => {
  it('matches the shared Solidity and TypeScript golden vectors', () => {
    for (const vector of monthlyScheduleVectors) {
      expect(
        nextMonthlySettlementUtc(new Date(vector.boundary), vector.settlementDay).toISOString(),
      ).toBe(vector.expected);
    }
  });

  const escrowFixturePath = resolve(
    __dirname,
    '../../../../escrow/test/fixtures/monthly-schedule-vectors.json',
  );
  const compareEscrowFixture = existsSync(escrowFixturePath) ? it : it.skip;
  compareEscrowFixture('uses the exact fixture pinned by the Solidity suite', () => {
    expect(JSON.parse(readFileSync(escrowFixturePath, 'utf8'))).toEqual(monthlyScheduleVectors);
  });

  it('uses the creation day for the default first settlement at UTC midnight', () => {
    expect(defaultFirstSettlementUtc(new Date('2026-08-03T18:45:12.000Z')).toISOString()).toBe(
      '2026-09-03T00:00:00.000Z',
    );
    expect(defaultFirstSettlementUtc(new Date('2026-08-31T23:59:59.999Z')).toISOString()).toBe(
      '2026-09-30T00:00:00.000Z',
    );
  });

  it('preserves the anchor after clamping a shorter month', () => {
    const february = nextMonthlySettlementUtc(new Date('2025-01-31T00:00:00.000Z'), 31);
    const march = nextMonthlySettlementUtc(february, 31);
    expect(february.toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(march.toISOString()).toBe('2025-03-31T00:00:00.000Z');

    const september = nextMonthlySettlementUtc(new Date('2026-08-31T00:00:00.000Z'), 31);
    expect(september.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(nextMonthlySettlementUtc(september, 31).toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });

  it('implements Gregorian leap-year rules, including century years', () => {
    expect(nextMonthlySettlementUtc(new Date('2000-01-31T00:00:00.000Z'), 31).toISOString()).toBe(
      '2000-02-29T00:00:00.000Z',
    );
    expect(nextMonthlySettlementUtc(new Date('2100-01-31T00:00:00.000Z'), 31).toISOString()).toBe(
      '2100-02-28T00:00:00.000Z',
    );
    expect(nextMonthlySettlementUtc(new Date('2200-01-31T00:00:00.000Z'), 31).toISOString()).toBe(
      '2200-02-28T00:00:00.000Z',
    );
  });

  it('treats a manual day 28 as day 28 rather than month end', () => {
    expect(nextMonthlySettlementUtc(new Date('2025-02-28T00:00:00.000Z'), 28).toISOString()).toBe(
      '2025-03-28T00:00:00.000Z',
    );
  });

  it('rolls December into January and rejects invalid inputs', () => {
    const january = nextMonthlySettlementUtc(new Date('2026-12-31T00:00:00.000Z'), 31);
    expect(january.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(isUtcMidnight(january)).toBe(true);
    expect(() => nextMonthlySettlementUtc(new Date('invalid'), 31)).toThrow(RangeError);
    expect(() => nextMonthlySettlementUtc(new Date('2026-01-31T12:00:00.000Z'), 31)).toThrow(
      '00:00 UTC',
    );
    expect(() => nextMonthlySettlementUtc(january, 0)).toThrow('integer from 1 to 31');
    expect(() => nextMonthlySettlementUtc(january, 31.5)).toThrow('integer from 1 to 31');
  });
});
