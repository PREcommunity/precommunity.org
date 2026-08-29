import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateKeywordMarketFeatureDto } from './application-features.dto';

describe('UpdateKeywordMarketFeatureDto', () => {
  it('accepts only an explicit boolean', async () => {
    await expect(
      validate(plainToInstance(UpdateKeywordMarketFeatureDto, { enabled: false })),
    ).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(UpdateKeywordMarketFeatureDto, { enabled: 'false' })),
    ).resolves.not.toHaveLength(0);
  });
});
