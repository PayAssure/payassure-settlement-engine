import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export default class FakeB2bCallbackDto {
  @ApiProperty({ example: 'B2B-0001', description: 'Identifier assigned by the fake B2B gateway.' })
  @IsString()
  @IsNotEmpty()
  transactionId: string = '';

  @ApiProperty({ example: 'PAY-001', description: 'Reference of the original payout instruction.' })
  @IsString()
  @IsNotEmpty()
  reference: string = '';

  @ApiProperty({ example: 'SUCCESS', description: 'Final status returned by the fake B2B gateway.' })
  @IsString()
  @IsNotEmpty()
  status: string = 'SUCCESS';

  @ApiPropertyOptional({ example: 'MPESA123456', description: 'Provider reference for the payment.' })
  @IsOptional()
  providerReference?: string;
}
