import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProposalVoteChoice } from '@precommunity/database';

const Trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateProposalDto {
  @Trimmed() @IsString() @MinLength(4) @MaxLength(120) title!: string;
  @Trimmed() @IsString() @MinLength(20) @MaxLength(5000) description!: string;
  @Trimmed() @IsString() @IsNotEmpty() @MaxLength(60) category!: string;
}

export class UpdateProposalDto {
  @Trimmed() @IsOptional() @IsString() @MinLength(4) @MaxLength(120) title?: string;
  @Trimmed() @IsOptional() @IsString() @MinLength(20) @MaxLength(5000) description?: string;
  @Trimmed() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) category?: string;
}

export class CommentDto {
  @Trimmed() @IsString() @MinLength(2) @MaxLength(2000) body!: string;
}
export class VoteDto {
  @IsEnum(ProposalVoteChoice) choice!: ProposalVoteChoice;
}
export class ModerationDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ProposalSettingsDto {
  @IsBoolean() proposalModerationEnabled!: boolean;
}
