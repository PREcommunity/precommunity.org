import 'reflect-metadata';
import { PATH_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { Role } from '@precommunity/database';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../common/roles';
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
