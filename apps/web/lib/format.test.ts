import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatMonth,
  formatUtcTimestamp,
  forumTopicTitle,
  shortAddress,
  statusLabel,
} from './format';

describe('public formatting', () => {
  it('formats exact token units without Number coercion', () => {
    expect(formatAmount('9007199254740993.000000000000000001', 'PRE')).toBe(
      '9,007,199,254,740,993.000000000000000001 PRE',
    );
    expect(formatAmount('1250.40', 'USDC')).toBe('1,250.40 USDC');
  });

  it('formats report months in UTC', () => {
    expect(formatMonth('2026-07')).toBe('July 2026');
  });
  it('keeps hydrated activity timestamps deterministic', () => {
    expect(formatUtcTimestamp('2099-08-15T11:00:00.000Z')).toBe('Aug 15, 2099, 11:00 UTC');
  });
  it('shortens public identifiers without hiding their proof', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });
  it('explains the derived expired state', () => {
    expect(statusLabel('EXPIRED')).toBe('Expired - awaiting settlement');
  });
  it('attributes forum tombstones to the correct action', () => {
    expect(forumTopicTitle(null, 'DELETED')).toBe('Topic deleted by its author');
    expect(forumTopicTitle(null, 'REMOVED')).toBe('Topic removed by a moderator');
  });
});
