import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ADS_MAX_KEYWORD_CHARACTERS } from '@precommunity/shared';

export class AdAdminKeywordQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(ADS_MAX_KEYWORD_CHARACTERS)
  q?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;
}
