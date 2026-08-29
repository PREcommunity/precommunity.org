import type { AdminSafeStatus, AdminSessionPrincipal } from './admin-workspace-types';

export function hasAdminWorkspaceRole(principal: AdminSessionPrincipal): boolean {
  return principal.roles.some(
    (role) => role === 'SUPER_ADMIN' || role === 'CONTENT_ADMIN' || role === 'FINANCE_ADMIN',
  );
}

export function canAccessSafeOwnershipAcceptance(status: AdminSafeStatus): boolean {
  return status.safeOwner && Boolean(status.isPendingEscrowOwner);
}
