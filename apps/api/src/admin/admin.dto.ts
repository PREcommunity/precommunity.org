import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotContains,
  IsArray,
  IsBoolean,
  IsEnum,
  IsEthereumAddress,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ExpenseCadence,
  FundingAsset,
  MonthlySurplusPolicy,
  Role,
  SafeGoalActionKind,
} from '@precommunity/database';

export class CreateSubprojectDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsOptional() @IsString() description?: string;
}

export class FundingTargetDto {
  @IsEnum(FundingAsset) asset!: FundingAsset;
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d+)?$/) amount!: string;
}

export class GoalDocumentDto {
  @IsString() @IsNotEmpty() label!: string;
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) url!: string;
}

export class CreateExpenseDto {
  @IsOptional() @IsString() @IsNotEmpty() @IsUUID() subprojectId?: string | null;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsString() description!: string;
  @IsString() purpose!: string;
  @IsOptional() @IsString() @IsNotEmpty() category?: string | null;
  @IsEnum(ExpenseCadence) cadence!: ExpenseCadence;
  @ValidateIf((input: CreateExpenseDto) => input.cadence === ExpenseCadence.MONTHLY)
  @IsEnum(MonthlySurplusPolicy)
  monthlySurplusPolicy?: MonthlySurplusPolicy;
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/)
  firstSettlementAt?: string | null;
  @IsEthereumAddress() recipientAddress!: string;
  @ValidateIf((input: CreateExpenseDto) => input.cadence === ExpenseCadence.ONE_TIME)
  @IsISO8601()
  deadline?: string;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) discussionUrl?:
    string | null;
  @IsOptional()
  @IsString()
  @Matches(/^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:\/\S*)?$/)
  metadataUri?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoalDocumentDto)
  documents?: GoalDocumentDto[];
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FundingTargetDto)
  targets!: FundingTargetDto[];
}

export class UpdateExpenseDto {
  @IsOptional() @IsString() @IsNotEmpty() @IsUUID() subprojectId?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() @IsNotEmpty() category?: string | null;
  @IsOptional() @IsEnum(ExpenseCadence) cadence?: ExpenseCadence;
  @IsOptional() @IsEthereumAddress() recipientAddress?: string;
  @IsOptional() @IsISO8601() deadline?: string | null;
  @IsOptional()
  @IsEnum(MonthlySurplusPolicy)
  monthlySurplusPolicy?: MonthlySurplusPolicy | null;
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/)
  firstSettlementAt?: string | null;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) discussionUrl?:
    string | null;
  @IsOptional()
  @IsString()
  @Matches(/^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:\/\S*)?$/)
  metadataUri?: string | null;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoalDocumentDto)
  documents?: GoalDocumentDto[];
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FundingTargetDto)
  targets?: FundingTargetDto[];
}

export type SafeDelivery = 'SERVICE' | 'MANUAL';

export class PrepareSafeDeliveryDto {
  @IsOptional() @IsIn(['SERVICE', 'MANUAL']) delivery?: SafeDelivery;
  @IsOptional() @IsBoolean() confirmedAbsentFromSafe?: boolean;
}

export class ReleaseProposalDto extends PrepareSafeDeliveryDto {
  @IsEnum(FundingAsset) asset!: FundingAsset;
  @IsIn(['EXPENSE', 'CANCELLED_FUNDS']) kind!: 'EXPENSE' | 'CANCELLED_FUNDS';
  @Matches(/^[1-9]\d*$/) amountRaw!: string;
}

export class PrepareGoalLifecycleDto extends PrepareSafeDeliveryDto {
  @IsIn([
    SafeGoalActionKind.SET_MONTHLY_SURPLUS_POLICY,
    SafeGoalActionKind.REQUEST_MONTHLY_STOP,
    SafeGoalActionKind.CANCEL_MONTHLY,
  ])
  kind!:
    | typeof SafeGoalActionKind.SET_MONTHLY_SURPLUS_POLICY
    | typeof SafeGoalActionKind.REQUEST_MONTHLY_STOP
    | typeof SafeGoalActionKind.CANCEL_MONTHLY;

  @ValidateIf(
    (input: PrepareGoalLifecycleDto) =>
      input.kind === SafeGoalActionKind.SET_MONTHLY_SURPLUS_POLICY,
  )
  @IsEnum(MonthlySurplusPolicy)
  monthlySurplusPolicy?: MonthlySurplusPolicy;
}

export class ChainSubmissionDto {
  @Matches(/^0x[a-fA-F0-9]{64}$/) txHash!: string;
}

export class UpdateGoalManagerDto extends PrepareSafeDeliveryDto {
  @IsBoolean() enabled!: boolean;
}

export class AssignRolesDto {
  @IsEthereumAddress() address!: string;
  @IsArray()
  @IsEnum(Role, { each: true })
  @ArrayNotContains([Role.SUPER_ADMIN], {
    message: 'SUPER_ADMIN follows the on-chain contract owner',
  })
  roles!: Role[];
}

export class ModerateProfileDto {
  @IsBoolean() hidden!: boolean;
}
