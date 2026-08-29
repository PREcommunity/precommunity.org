import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { KeywordMarketEnabledGuard } from '../features/keyword-market-enabled.guard';
import { AdsAdminController, AdsController } from './ads.controller';

describe('PRE Keyword Market controller routing', () => {
  it('mounts public and authenticated endpoints under the neutral prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdsController)).toBe('keyword-market');
    expect(Reflect.getMetadata(PATH_METADATA, AdsAdminController)).toBe('keyword-market/admin');
  });

  it('gates both controller surfaces behind the runtime feature flag', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsController)).toContain(
      KeywordMarketEnabledGuard,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsAdminController)).toContain(
      KeywordMarketEnabledGuard,
    );
  });
});
