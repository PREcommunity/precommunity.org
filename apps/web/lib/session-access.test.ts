import { describe, expect, it } from 'vitest';
import {
  canAccessAdmin,
  canManageKeywordMarketApiKeys,
  canModerateKeywordMarket,
  type SessionRole,
} from './session-access';

describe('canAccessAdmin', () => {
  it.each<SessionRole>(['SUPER_ADMIN', 'CONTENT_ADMIN', 'FINANCE_ADMIN'])(
    'allows the %s role',
    (role) => {
      expect(canAccessAdmin([role])).toBe(true);
    },
  );

  it('hides Admin from signed-out visitors', () => {
    expect(canAccessAdmin()).toBe(false);
    expect(canAccessAdmin([])).toBe(false);
  });

  it('allows a pending Safe owner to reach the ownership acceptance flow', () => {
    expect(canAccessAdmin([], true)).toBe(true);
  });
});

describe('canManageKeywordMarketApiKeys', () => {
  it('limits API key management to super admins', () => {
    expect(canManageKeywordMarketApiKeys(['SUPER_ADMIN'])).toBe(true);
    expect(canManageKeywordMarketApiKeys(['SUPER_ADMIN', 'CONTENT_ADMIN'])).toBe(true);
    expect(canManageKeywordMarketApiKeys(['CONTENT_ADMIN'])).toBe(false);
    expect(canManageKeywordMarketApiKeys(['FINANCE_ADMIN'])).toBe(false);
    expect(canManageKeywordMarketApiKeys()).toBe(false);
  });
});

describe('canModerateKeywordMarket', () => {
  it.each<SessionRole>(['SUPER_ADMIN', 'CONTENT_ADMIN'])('allows the %s role', (role) => {
    expect(canModerateKeywordMarket([role])).toBe(true);
  });

  it('does not expose moderation to advertisers, signed-out visitors or finance-only admins', () => {
    expect(canModerateKeywordMarket()).toBe(false);
    expect(canModerateKeywordMarket([])).toBe(false);
    expect(canModerateKeywordMarket(['FINANCE_ADMIN'])).toBe(false);
  });
});
