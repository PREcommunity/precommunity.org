export type ShareContentKind = 'forum topic' | 'proposal' | 'goal';

export interface ShareTarget {
  kind: ShareContentKind;
  title: string;
  url: string;
}

export function shareText({ kind, title }: Pick<ShareTarget, 'kind' | 'title'>) {
  return `Check out this ${kind} on PRE Community: ${title}`;
}

export function xShareUrl(target: ShareTarget) {
  const url = new URL('https://x.com/intent/post');
  url.searchParams.set('text', shareText(target));
  url.searchParams.set('url', target.url);
  return url.toString();
}

export function telegramShareUrl(target: ShareTarget) {
  const url = new URL('https://t.me/share/url');
  url.searchParams.set('url', target.url);
  url.searchParams.set('text', shareText(target));
  return url.toString();
}
