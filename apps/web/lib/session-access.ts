export type SessionRole = 'SUPER_ADMIN' | 'CONTENT_ADMIN' | 'FINANCE_ADMIN';

export interface SessionPrincipal {
  address: `0x${string}`;
  roles?: SessionRole[];
  canAccessSafeOwnershipAcceptance?: boolean;
}

export function canAccessAdmin(
  roles: readonly SessionRole[] = [],
  canAccessSafeOwnershipAcceptance = false,
) {
  return (
    canAccessSafeOwnershipAcceptance ||
    roles.some(
      (role) => role === 'SUPER_ADMIN' || role === 'CONTENT_ADMIN' || role === 'FINANCE_ADMIN',
    )
  );
}

export function canModerateKeywordMarket(roles: readonly SessionRole[] = []) {
  return roles.includes('SUPER_ADMIN') || roles.includes('CONTENT_ADMIN');
}
