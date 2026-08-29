import { describe, expect, it } from 'vitest';
import { shareText, telegramShareUrl, xShareUrl } from './share';

const target = {
  kind: 'forum topic' as const,
  title: 'Search & privacy?',
  url: 'https://community.presearch.com/community/forum/search-privacy?month=2026-08',
};

describe('share URLs', () => {
  it('labels community content for share text', () => {
    expect(shareText(target)).toBe(
      'Check out this forum topic on PRE Community: Search & privacy?',
    );
  });

  it('encodes X share text and the page URL separately', () => {
    const url = new URL(xShareUrl(target));
    expect(url.origin).toBe('https://x.com');
    expect(url.pathname).toBe('/intent/post');
    expect(url.searchParams.get('text')).toBe(
      'Check out this forum topic on PRE Community: Search & privacy?',
    );
    expect(url.searchParams.get('url')).toBe(target.url);
  });

  it('encodes Telegram share text and the page URL separately', () => {
    const url = new URL(telegramShareUrl(target));
    expect(url.origin).toBe('https://t.me');
    expect(url.pathname).toBe('/share/url');
    expect(url.searchParams.get('text')).toBe(
      'Check out this forum topic on PRE Community: Search & privacy?',
    );
    expect(url.searchParams.get('url')).toBe(target.url);
  });
});
