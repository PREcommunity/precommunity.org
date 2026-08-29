import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AdReportReason, AdReportStatus } from '@precommunity/database';

const Trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class AdCreativeInputDto {
  @Trimmed() @IsString() @MaxLength(60) headline!: string;
  @Trimmed() @IsString() @IsNotEmpty() @MaxLength(160) description!: string;
  @Trimmed()
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  destinationUrl!: string;
}

export class CreateAdCampaignDto extends AdCreativeInputDto {
  @Trimmed() @IsString() @IsNotEmpty() @MaxLength(256) keyword!: string;
}

export class CreateAdRevisionDto extends AdCreativeInputDto {}

export class UpdateAdCampaignDto {
  @IsBoolean()
  paused!: boolean;
}

export class ReportAdDto {
  @IsEnum(AdReportReason)
  reason!: AdReportReason;

  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class ListAdAdminReportsDto {
  @IsOptional()
  @IsEnum(AdReportStatus)
  status: AdReportStatus = AdReportStatus.OPEN;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @Transform(({ value }: { value: unknown }) => (value === undefined ? 25 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export enum AdModerationAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  SUSPEND = 'SUSPEND',
  RESTORE = 'RESTORE',
}

export class ModerateAdRevisionDto {
  @IsEnum(AdModerationAction)
  action!: AdModerationAction;

  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export enum AdReportResolutionAction {
  DISMISS = 'DISMISS',
  SUSPEND_AD = 'SUSPEND_AD',
}

export class ResolveAdReportsDto {
  @IsEnum(AdReportResolutionAction)
  action!: AdReportResolutionAction;

  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
