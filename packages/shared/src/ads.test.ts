import { describe, expect, it } from 'vitest';
import { AdsTextValidationError, adsKeywordCandidates, normalizeAdKeyword } from './ads';

describe('PRE Keyword Market keyword normalization', () => {
  it('normalizes Unicode compatibility forms, case and separators', () => {
    expect(normalizeAdKeyword('  BITCOIN—Poland  ')).toBe('bitcoin poland');
    expect(normalizeAdKeyword('ŻÓŁTY  kot')).toBe('żółty kot');
    expect(normalizeAdKeyword('Ｗｅｂ３')).toBe('web3');
  });

  it('rejects empty and oversized keywords', () => {
    expect(() => normalizeAdKeyword('---')).toThrow(AdsTextValidationError);
    expect(() => normalizeAdKeyword('one two three four five six')).toThrow(
      'Keyword must contain at most 5 tokens.',
    );
  });
});

describe('PRE Keyword Market query candidates', () => {
  it('prioritizes the longest whole-token phrase', () => {
    const candidates = adsKeywordCandidates('bitcoin poland xyz');
    expect(
      candidates.findIndex((candidate) => candidate.keyword === 'bitcoin poland'),
    ).toBeLessThan(candidates.findIndex((candidate) => candidate.keyword === 'bitcoin'));
  });

  it('uses character length before position for equal token counts', () => {
    const candidates = adsKeywordCandidates('best bitcoin poland exchange');
    const twoToken = candidates.filter((candidate) => candidate.tokenCount === 2);
    expect(twoToken.map((candidate) => candidate.keyword)).toEqual([
      'poland exchange',
      'bitcoin poland',
      'best bitcoin',
    ]);
  });

  it('uses the earliest phrase when token and character lengths are equal', () => {
    const candidates = adsKeywordCandidates('aa bb cc');
    const twoToken = candidates.filter((candidate) => candidate.tokenCount === 2);
    expect(twoToken.map((candidate) => candidate.keyword)).toEqual(['aa bb', 'bb cc']);
  });

  it('does not create substring matches inside words', () => {
    const candidates = adsKeywordCandidates('bitcoins in poland');
    expect(candidates.some((candidate) => candidate.keyword === 'bitcoin')).toBe(false);
  });

  it('enforces the 256 character and 32 token query boundaries', () => {
    expect(() => adsKeywordCandidates('a'.repeat(257))).toThrow(
      'Query must contain at most 256 characters.',
    );
    expect(() => adsKeywordCandidates(Array.from({ length: 33 }, () => 'x').join(' '))).toThrow(
      'Query must contain at most 32 tokens.',
    );
    expect(adsKeywordCandidates(Array.from({ length: 32 }, () => 'x').join(' '))).not.toHaveLength(
      0,
    );
  });
});
