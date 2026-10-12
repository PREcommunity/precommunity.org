import 'reflect-metadata';
import { ForbiddenException, RequestMethod, type ExecutionContext } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Role } from '@precommunity/database';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../common/roles';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../common/roles.guard';
import {
  AdminApplicationFeaturesController,
  PublicApplicationFeaturesController,
} from './application-features.controller';
import { ApplicationFeaturesService } from './application-features.service';
import { KeywordMarketEnabledGuard } from './keyword-market-enabled.guard';

describe('application feature routes', () => {
  it('exposes a public read endpoint and an admin mutation endpoint', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PublicApplicationFeaturesController)).toBe(
      'public/features',
    );
    expect(Reflect.getMetadata(PATH_METADATA, AdminApplicationFeaturesController)).toBe(
      'admin/features',
    );
  });

  it('restricts the Keyword Market switch to SUPER_ADMIN', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminApplicationFeaturesController.prototype.updateKeywordMarket,
      ),
    ).toEqual([Role.SUPER_ADMIN]);
  });

  it('exposes a protected review requirement switch', () => {
    const handler = AdminApplicationFeaturesController.prototype.updateKeywordMarketReview;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('keyword-market/review');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PUT);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([Role.SUPER_ADMIN]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminApplicationFeaturesController)).toEqual([
      SessionGuard,
      RolesGuard,
    ]);
  });

  it.each([Role.CONTENT_ADMIN, Role.FINANCE_ADMIN])('rejects review updates by %s', (role) => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => AdminApplicationFeaturesController.prototype.updateKeywordMarketReview,
      getClass: () => AdminApplicationFeaturesController,
      switchToHttp: () => ({ getRequest: () => ({ principal: { roles: [role] } }) }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('accepts review updates by SUPER_ADMIN', () => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => AdminApplicationFeaturesController.prototype.updateKeywordMarketReview,
      getClass: () => AdminApplicationFeaturesController,
      switchToHttp: () => ({ getRequest: () => ({ principal: { roles: [Role.SUPER_ADMIN] } }) }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it.each([
    PublicApplicationFeaturesController,
    AdminApplicationFeaturesController,
    KeywordMarketEnabledGuard,
  ])('declares the feature service injection token for %s', (target) => {
    expect(Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target)).toContainEqual({
      index: 0,
      param: ApplicationFeaturesService,
    });
  });
});
