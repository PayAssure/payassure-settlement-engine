import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class PaymentMethodDto {
  @ApiProperty({ example: 'MPESA', description: 'Payout method type. Only one payout destination may be configured at a time.' })
  @IsIn(['MPESA', 'BANK'])
  type!: 'MPESA' | 'BANK';

  @ApiProperty({ example: 'John Doe', description: 'Account or beneficiary name for payout verification.' })
  @IsNotEmpty()
  @IsString()
  accountName!: string;

  @ApiProperty({ example: true, description: 'Whether the payout destination has been verified.' })
  @IsBoolean()
  isVerified!: boolean;

  @ApiPropertyOptional({ example: '254712345678', description: 'Phone number for MPESA payouts.' })
  @ValidateIf((o) => o.type === 'MPESA')
  @IsNotEmpty()
  @IsString()
  payerPhoneNumber?: string;

  @ApiPropertyOptional({ example: 'Safaricom', description: 'Optional payment provider or network name.' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ example: '07', description: 'Bank code for BANK payouts.' })
  @ValidateIf((o) => o.type === 'BANK')
  @IsNotEmpty()
  @IsString()
  bankCode?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'Bank account number for BANK payouts.' })
  @ValidateIf((o) => o.type === 'BANK')
  @IsNotEmpty()
  @IsString()
  accountNumber?: string;
}
