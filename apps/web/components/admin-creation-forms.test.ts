import { describe, expect, it } from 'vitest';
import { monthlyPeriodPreview } from './admin-creation-forms';
import { validationMessageFor } from './form-validation';
import { monthlyOverrideDateBounds, utcDateInputToIso } from './monthly-schedule-fields';

const validity = (
  overrides: Partial<
    Pick<ValidityState, 'valid' | 'valueMissing' | 'patternMismatch' | 'typeMismatch'>
  > = {},
) => ({
  valid: false,
  valueMissing: false,
  patternMismatch: false,
  typeMismatch: false,
  tooShort: false,
  tooLong: false,
  ...overrides,
});

describe('creation form validation messages', () => {
  it('explains the slug format instead of only highlighting the field', () => {
    expect(validationMessageFor('slug', validity({ patternMismatch: true }))).toBe(
      'Use lowercase letters, numbers and hyphens only, for example payout-with-surplus.',
    );
  });

  it('provides field-specific required and URL messages', () => {
    expect(validationMessageFor('recipientAddress', validity({ valueMissing: true }))).toBe(
      'Enter the recipient address.',
    );
    expect(validationMessageFor('discussionUrl', validity({ typeMismatch: true }))).toBe(
      'Enter a complete URL beginning with http:// or https://.',
    );
  });

  it('clears a message as soon as the value is valid', () => {
    expect(validationMessageFor('slug', validity({ valid: true }))).toBe('');
  });
});

describe('monthly period preview', () => {
  it('starts immediately and settles on the same UTC day in the next month', () => {
    expect(monthlyPeriodPreview(new Date('2028-02-01T00:00:00.000Z'))).toEqual({
      startsAt: '2028-02-01T00:00:00.000Z',
      endsAt: '2028-03-01T00:00:00.000Z',
      settlementDay: 1,
      settlementDates: [
        '2028-03-01T00:00:00.000Z',
        '2028-04-01T00:00:00.000Z',
        '2028-05-01T00:00:00.000Z',
      ],
    });
  });

  it('keeps day 31 across a clamped leap-year February', () => {
    expect(monthlyPeriodPreview(new Date('2028-01-31T23:59:59.000Z'))).toEqual({
      startsAt: '2028-01-31T23:59:59.000Z',
      endsAt: '2028-02-29T00:00:00.000Z',
      settlementDay: 31,
      settlementDates: [
        '2028-02-29T00:00:00.000Z',
        '2028-03-31T00:00:00.000Z',
        '2028-04-30T00:00:00.000Z',
      ],
    });
  });

  it('uses the chosen override day as the recurring base day', () => {
    expect(monthlyPeriodPreview(new Date('2028-01-01T12:00:00.000Z'), '2028-02-28')).toEqual({
      startsAt: '2028-01-01T12:00:00.000Z',
      endsAt: '2028-02-28T00:00:00.000Z',
      settlementDay: 28,
      settlementDates: [
        '2028-02-28T00:00:00.000Z',
        '2028-03-28T00:00:00.000Z',
        '2028-04-28T00:00:00.000Z',
      ],
    });
  });

  it('handles December rollover', () => {
    expect(monthlyPeriodPreview(new Date('2028-12-15T12:00:00.000Z'))).toEqual({
      startsAt: '2028-12-15T12:00:00.000Z',
      endsAt: '2029-01-15T00:00:00.000Z',
      settlementDay: 15,
      settlementDates: [
        '2029-01-15T00:00:00.000Z',
        '2029-02-15T00:00:00.000Z',
        '2029-03-15T00:00:00.000Z',
      ],
    });
  });

  it('derives exact date-input bounds from the contract timestamp window', () => {
    expect(monthlyOverrideDateBounds(new Date('2028-08-01T00:00:00.000Z'))).toEqual({
      min: '2028-08-08',
      max: '2028-09-30',
    });
    expect(monthlyOverrideDateBounds(new Date('2028-08-01T12:00:00.000Z'))).toEqual({
      min: '2028-08-09',
      max: '2028-09-30',
    });
  });

  it('interprets an HTML date as UTC midnight without a DST shift', () => {
    expect(utcDateInputToIso('2028-03-26')).toBe('2028-03-26T00:00:00.000Z');
    expect(utcDateInputToIso('2028-02-31')).toBeUndefined();
  });
});
