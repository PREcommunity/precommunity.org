import { describe, expect, it, vi } from 'vitest';
import { replyIdFromHash, subscribeToReplyHash } from './forum-reply-hash';

describe('forum reply hashes', () => {
  it('recognizes reply targets used by in-page navigation', () => {
    expect(replyIdFromHash('#reply-123')).toBe('123');
    expect(replyIdFromHash('#reply-')).toBeNull();
    expect(replyIdFromHash('#topic-intro')).toBeNull();
  });

  it('reports both the initial hash and later in-page hash changes', () => {
    const handlers: { hashchange?: () => void } = {};
    const target = {
      location: { hash: '#reply-first' },
      addEventListener: (_type: 'hashchange', listener: () => void) => {
        handlers.hashchange = listener;
      },
      removeEventListener: vi.fn(),
    };
    const listener = vi.fn();

    const unsubscribe = subscribeToReplyHash(target, listener);
    target.location.hash = '#reply-older';
    handlers.hashchange?.();

    expect(listener).toHaveBeenNthCalledWith(1, 'first');
    expect(listener).toHaveBeenNthCalledWith(2, 'older');
    unsubscribe();
    expect(target.removeEventListener).toHaveBeenCalledWith('hashchange', expect.any(Function));
  });
});
