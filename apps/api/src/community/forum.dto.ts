import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ForumCategory } from '@precommunity/database';

const Trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateForumTopicDto {
  @Trimmed() @IsString() @MinLength(4) @MaxLength(120) title!: string;
  @Trimmed() @IsString() @MinLength(10) @MaxLength(5000) body!: string;
  @IsEnum(ForumCategory) category!: ForumCategory;
}

export class UpdateForumTopicDto {
  @Trimmed() @IsOptional() @IsString() @MinLength(4) @MaxLength(120) title?: string;
  @Trimmed() @IsOptional() @IsString() @MinLength(10) @MaxLength(5000) body?: string;
  @IsOptional() @IsEnum(ForumCategory) category?: ForumCategory;
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
  @ValidateIf((_, value) => value !== undefined) @IsEnum(ForumCategory) category?: ForumCategory;
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
