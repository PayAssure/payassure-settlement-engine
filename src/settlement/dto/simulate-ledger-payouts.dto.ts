import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export default class SimulateLedgerPayoutsDto {
  @ApiProperty({ example: 'TXN-20260703-000001', description: 'Merchant transaction reference tied to a successful payment callback.' })
  @IsString()
  @IsNotEmpty()
  merchantTransactionReference: string = '';

  @ApiPropertyOptional({ enum: ['PENDING', 'PAID', 'FAILED'], example: 'PAID', description: 'Simulation outcome to apply to the fake B2B payout transactions.' })
  @IsString()
  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'FAILED'])
  simulationStatus?: string = 'PAID';
}
