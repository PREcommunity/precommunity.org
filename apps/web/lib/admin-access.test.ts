import { describe, expect, it } from 'vitest';
import type { AdminSafeStatus, AdminSessionPrincipal } from './admin-workspace-types';
import { canAccessSafeOwnershipAcceptance, hasAdminWorkspaceRole } from './admin-access';

const principal: AdminSessionPrincipal = {
  address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  roles: [],
  chainAuthorities: [],
  safeOwner: false,
  canAccessSafeOwnershipAcceptance: true,
  safeAddress: '0x2222222222222222222222222222222222222222',
};

const status: AdminSafeStatus = {
  configured: true,
  serviceConfigured: true,
  network: 'base-sepolia',
  networkName: 'Base Sepolia',
  chainId: 84532,
  escrowAddress: '0x04a8CeABccE6bC13d3Cc89392D9AE39b43bD2a4D',
  isPendingEscrowOwner: true,
  safeOwner: true,
};

describe('admin workspace access', () => {
  it.each<AdminSessionPrincipal['roles'][number]>([
    'SUPER_ADMIN',
    'CONTENT_ADMIN',
    'FINANCE_ADMIN',
  ])('admits %s to the full workspace', (role) => {
    expect(hasAdminWorkspaceRole({ ...principal, roles: [role] })).toBe(true);
  });

  it('admits a pending Safe owner only to the ownership acceptance flow', () => {
    expect(hasAdminWorkspaceRole(principal)).toBe(false);
    expect(canAccessSafeOwnershipAcceptance(status)).toBe(true);
  });

  it('rejects a wallet that the fresh Safe status does not identify as an owner', () => {
    expect(canAccessSafeOwnershipAcceptance({ ...status, safeOwner: false })).toBe(false);
  });
});
