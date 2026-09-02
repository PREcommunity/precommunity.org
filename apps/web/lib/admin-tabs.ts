import type { SessionRole } from './session-access';

export const adminTabs = [
  { id: 'operations', label: 'Operations' },
  { id: 'forum', label: 'Forum' },
  { id: 'goals', label: 'Goals' },
  { id: 'keyword-marketplace', label: 'Keyword Marketplace' },
] as const;

export type AdminTab = (typeof adminTabs)[number]['id'];

export function availableAdminTabs(roles: readonly SessionRole[]) {
  if (!roles.length) return adminTabs.slice(0, 1);
  const canModerateCommunity = roles.some(
    (role) => role === 'SUPER_ADMIN' || role === 'CONTENT_ADMIN',
  );
  return adminTabs.filter((tab) => tab.id !== 'forum' || canModerateCommunity);
}

export function resolveAdminTab(
  value: string | null,
  available: readonly (typeof adminTabs)[number][] = adminTabs,
): AdminTab {
  return available.find((tab) => tab.id === value)?.id ?? available[0]?.id ?? 'operations';
}
