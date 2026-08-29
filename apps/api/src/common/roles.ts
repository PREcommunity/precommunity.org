import { SetMetadata } from '@nestjs/common';
import type { Role } from '@precommunity/database';

export const ROLES_KEY = 'required-roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
