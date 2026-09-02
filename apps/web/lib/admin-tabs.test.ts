import { describe, expect, it } from 'vitest';
import { availableAdminTabs, resolveAdminTab } from './admin-tabs';

describe('admin tabs', () => {
  it.each(['SUPER_ADMIN', 'CONTENT_ADMIN'] as const)('shows all tabs to %s', (role) => {
    expect(availableAdminTabs([role]).map((tab) => tab.id)).toEqual([
      'operations',
      'forum',
      'goals',
      'keyword-marketplace',
    ]);
  });

  it('hides forum from finance administrators', () => {
    expect(availableAdminTabs(['FINANCE_ADMIN']).map((tab) => tab.id)).toEqual([
      'operations',
      'goals',
      'keyword-marketplace',
    ]);
  });

  it('limits a Safe-only or signed-out session to operations', () => {
    expect(availableAdminTabs([]).map((tab) => tab.id)).toEqual(['operations']);
  });

  it('falls back to the first available tab for invalid or unavailable values', () => {
    const financeTabs = availableAdminTabs(['FINANCE_ADMIN']);
    expect(resolveAdminTab('goals', financeTabs)).toBe('goals');
    expect(resolveAdminTab('forum', financeTabs)).toBe('operations');
    expect(resolveAdminTab('unknown', financeTabs)).toBe('operations');
    expect(resolveAdminTab(null, financeTabs)).toBe('operations');
  });
});
