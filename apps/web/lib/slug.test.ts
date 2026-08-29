import { describe, expect, it } from 'vitest';
import { normalizeSlugSpaces } from './slug';

describe('normalizeSlugSpaces', () => {
  it('replaces spaces with hyphens', () => {
    expect(normalizeSlugSpaces('community growth goal')).toBe('community-growth-goal');
  });

  it('handles pasted whitespace and avoids duplicate hyphens', () => {
    expect(normalizeSlugSpaces('community\t growth  -goal')).toBe('community-growth-goal');
  });
});
