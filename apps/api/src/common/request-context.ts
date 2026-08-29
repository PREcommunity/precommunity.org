import type { ChainAuthorityKind, Role } from '@precommunity/database';
import type { Request } from 'express';

export interface AuthenticatedPrincipal {
  userId: string;
  address: string;
  roles: Role[];
  chainAuthorities: ChainAuthorityKind[];
  chainOwnerAddress: string | null;
  safeOwner: boolean;
  canAccessSafeOwnershipAcceptance: boolean;
  safeAddress: string | null;
}

export interface AuthenticatedRequest extends Request {
  principal?: AuthenticatedPrincipal;
}
