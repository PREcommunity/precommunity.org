import { IsBoolean } from 'class-validator';

export class UpdateKeywordMarketFeatureDto {
  @IsBoolean() enabled!: boolean;
}
