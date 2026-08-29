import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@precommunity/database';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from './roles.guard';

function contextFor(roles: Role[]): ExecutionContext {
  const request = {
    principal: {
      userId: 'user-1',
      address: '0x0000000000000000000000000000000000000001',
      roles,
    },
  };

  return {
    getHandler: () => contextFor,
    getClass: () => RolesGuard,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: () => [Role.FINANCE_ADMIN],
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);

  it('accepts a wallet carrying a required role', () => {
    expect(guard.canActivate(contextFor([Role.FINANCE_ADMIN]))).toBe(true);
  });

  it('rejects a wallet without a required role', () => {
    expect(() => guard.canActivate(contextFor([Role.CONTENT_ADMIN]))).toThrow(ForbiddenException);
  });
});
