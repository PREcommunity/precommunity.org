import { IsBoolean } from 'class-validator';

export class UpdateKeywordMarketFeatureDto {
  @IsBoolean() enabled!: boolean;
}

export class UpdateKeywordMarketReviewDto {
  @IsBoolean() requireReview!: boolean;
}
