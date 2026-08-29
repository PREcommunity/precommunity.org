export function replyIdFromHash(hash: string) {
  const prefix = '#reply-';
  return hash.startsWith(prefix) && hash.length > prefix.length ? hash.slice(prefix.length) : null;
}

interface ReplyHashTarget {
  location: { hash: string };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

export function subscribeToReplyHash(
  target: ReplyHashTarget,
  listener: (replyId: string | null) => void,
) {
  const notify = () => listener(replyIdFromHash(target.location.hash));
  target.addEventListener('hashchange', notify);
  notify();
  return () => target.removeEventListener('hashchange', notify);
}
