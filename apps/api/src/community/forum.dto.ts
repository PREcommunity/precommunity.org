import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const Trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const CATEGORY_VALUE_PATTERN = /^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$/u;

export class CreateForumTopicDto {
  @Trimmed() @IsString() @MinLength(4) @MaxLength(120) title!: string;
  @Trimmed() @IsString() @MinLength(10) @MaxLength(5000) body!: string;
  @Trimmed() @IsString() @MaxLength(64) @Matches(CATEGORY_VALUE_PATTERN) category!: string;
}

export class UpdateForumTopicDto {
  @Trimmed() @IsOptional() @IsString() @MinLength(4) @MaxLength(120) title?: string;
  @Trimmed() @IsOptional() @IsString() @MinLength(10) @MaxLength(5000) body?: string;
  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(CATEGORY_VALUE_PATTERN)
  category?: string;
}

export class ForumDraftDto {
  @Trimmed()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(120)
  title?: string;
  @Trimmed()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(5000)
  body?: string;
  @Trimmed()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @Matches(CATEGORY_VALUE_PATTERN)
  category?: string;
}

export class CreateForumCategoryDto {
  @Trimmed() @IsString() @MinLength(1) @MaxLength(80) label!: string;
}

export class UpdateForumCategoryDto {
  @Trimmed() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) label?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class ForumReplyDto {
  @Trimmed() @IsString() @MinLength(2) @MaxLength(2000) body!: string;
  @IsOptional() @IsUUID() parentReplyId?: string;
}

export class ForumSettingsDto {
  @IsBoolean() topicModerationEnabled!: boolean;
}

export class ForumMinimumPreDto {
  @Trimmed()
  @IsString()
  @MaxLength(79)
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/)
  amount!: string;
}
