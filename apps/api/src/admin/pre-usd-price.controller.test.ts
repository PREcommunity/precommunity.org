import 'reflect-metadata';
import { type ExecutionContext, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Role } from '@precommunity/database';
import { describe, expect, it } from 'vitest';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../common/roles.guard';
import { PreUsdPriceController } from './pre-usd-price.controller';

function context(method: keyof PreUsdPriceController, roles: Role[]): ExecutionContext {
  return {
    getHandler: () => PreUsdPriceController.prototype[method],
    getClass: () => PreUsdPriceController,
    switchToHttp: () => ({ getRequest: () => ({ principal: { roles } }) }),
  } as unknown as ExecutionContext;
}

describe('admin PRE/USD price routes', () => {
  it('requires an authenticated wallet and role checks on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PreUsdPriceController)).toEqual([
      SessionGuard,
      RolesGuard,
    ]);
  });

  it.each([Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN])(
    'allows %s to view the saved price',
    (role) => {
      expect(new RolesGuard(new Reflector()).canActivate(context('latest', [role]))).toBe(true);
    },
  );

  it.each(['refresh', 'refreshStatus'] as const)('restricts %s to SUPER_ADMIN', (method) => {
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(context(method, [Role.SUPER_ADMIN]))).toBe(true);
    for (const role of [Role.CONTENT_ADMIN, Role.FINANCE_ADMIN]) {
      expect(() => guard.canActivate(context(method, [role]))).toThrow(ForbiddenException);
    }
    expect(() => guard.canActivate(context(method, []))).toThrow(ForbiddenException);
  });

  it('rejects non-admin price reads', () => {
    expect(() => new RolesGuard(new Reflector()).canActivate(context('latest', []))).toThrow(
      ForbiddenException,
    );
  });

  it.each(['latest', 'refresh', 'refreshStatus'] as const)('prevents caching on %s', (method) => {
    expect(
      Reflect.getMetadata(HEADERS_METADATA, PreUsdPriceController.prototype[method]),
    ).toContainEqual({
      name: 'Cache-Control',
      value: 'no-store',
    });
  });

  it('accepts manual refresh asynchronously and validates its status identifier', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, PreUsdPriceController.prototype.refresh)).toBe(
      202,
    );
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      PreUsdPriceController,
      'refreshStatus',
    ) as Record<string, { pipes?: unknown[] }>;
    expect(Object.values(args).flatMap((arg) => arg.pipes ?? [])).toContain(ParseUUIDPipe);
  });
});
