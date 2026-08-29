import { IsEthereumAddress, IsNotEmpty, IsString } from 'class-validator';

export class NonceRequestDto {
  @IsEthereumAddress()
  address!: string;
}

export class VerifySiweDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsString()
  @IsNotEmpty()
  signature!: string;
}
