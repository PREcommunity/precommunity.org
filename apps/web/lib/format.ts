import type { AssetCode, ForumTopicSummary, GoalStatus } from '@precommunity/shared';

export function formatAmount(value: string | number, asset: AssetCode) {
  const normalized = String(value)
    .replaceAll(',', '')
    .replace(/^(-?)0+(?=\d)/, '$1');
  const [integer = '0', fraction = ''] = normalized.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const exact = fraction ? `${grouped}.${fraction}` : grouped;
  return `${exact} ${asset}`;
}

export function formatMonth(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value}-01T00:00:00Z`),
  );
}

export function formatDeadline(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function formatUtcTimestamp(value: string) {
  const date = new Date(value);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function forumTopicTitle(title: string | null, state: ForumTopicSummary['state']) {
  if (title) return title;
  if (state === 'REMOVED') return 'Topic removed by a moderator';
  if (state === 'DELETED') return 'Topic deleted by its author';
  return 'Topic unavailable';
}

export function statusLabel(status: GoalStatus) {
  if (status === 'EXPIRED') return 'Expired - awaiting settlement';
  if (status === 'SETTLED') return 'Funds released';
  return status.charAt(0) + status.slice(1).toLowerCase();
}
