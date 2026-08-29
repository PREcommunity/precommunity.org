import { Type } from 'class-transformer';
import {
  IsEthereumAddress,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { OperationType } from '@safe-global/types-kit';

export class SafeTransactionDataDto {
  @IsEthereumAddress() to!: string;
  @Matches(/^\d+$/) value!: string;
  @Matches(/^0x(?:[a-fA-F0-9]{2})*$/) data!: string;
  @IsIn([OperationType.Call, OperationType.DelegateCall]) operation!: OperationType;
  @Matches(/^\d+$/) safeTxGas!: string;
  @Matches(/^\d+$/) baseGas!: string;
  @Matches(/^\d+$/) gasPrice!: string;
  @IsEthereumAddress() gasToken!: string;
  @IsEthereumAddress() refundReceiver!: string;
  @IsInt() @Min(0) nonce!: number;
}

export class SubmitSafeTransactionProposalDto {
  @ValidateNested()
  @Type(() => SafeTransactionDataDto)
  transaction!: SafeTransactionDataDto;

  @Matches(/^0x[a-fA-F0-9]{64}$/) safeTxHash!: string;
  @IsEthereumAddress() senderAddress!: string;
  @IsString() @Matches(/^0x[a-fA-F0-9]+$/) senderSignature!: string;
}

export class SubmitSafePayoutProposalDto extends SubmitSafeTransactionProposalDto {}
