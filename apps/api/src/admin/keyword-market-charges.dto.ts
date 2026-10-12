import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class UpdateAdChargeSettingsDto {
  @IsBoolean() automaticEnabled!: boolean;
  @IsInt() @Min(1) @Max(2_147_483_647) intervalMinutes!: number;
  @IsInt() @Min(1) @Max(2_147_483_647) clickThreshold!: number;
}

export class AdChargeHistoryQueryDto {
  @IsOptional() @IsUUID() cursor?: string;
}
