import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  UpdateKeywordMarketFeatureDto,
  UpdateKeywordMarketReviewDto,
} from './application-features.dto';

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

describe('UpdateKeywordMarketReviewDto', () => {
  it.each([true, false])('accepts an explicit %s boolean', async (requireReview) => {
    await expect(
      validate(plainToInstance(UpdateKeywordMarketReviewDto, { requireReview })),
    ).resolves.toHaveLength(0);
  });

  it.each([undefined, null, 'false', 'true', 0, 1])(
    'rejects non-boolean %s',
    async (requireReview) => {
      await expect(
        validate(plainToInstance(UpdateKeywordMarketReviewDto, { requireReview })),
      ).resolves.not.toHaveLength(0);
    },
  );
});
