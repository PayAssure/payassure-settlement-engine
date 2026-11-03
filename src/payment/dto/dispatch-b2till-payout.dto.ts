import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, IsString } from 'class-validator';

export default class DispatchB2TillPayoutDto {
  @ApiProperty({ example: '239', description: 'Amount to send to the till.' })
  @IsNumberString()
  @IsNotEmpty()
  Amount: string = '';

  @ApiProperty({ example: '000000', description: 'Till number receiving the payment.' })
  @IsString()
  @IsNotEmpty()
  PartyB: string = '';

  @ApiProperty({ example: '353353', description: 'Account reference for the payment.' })
  @IsString()
  @IsNotEmpty()
  AccountReference: string = '';

  @ApiProperty({ example: '254700000000', description: 'Requester phone number.' })
  @IsString()
  @IsNotEmpty()
  Requester: string = '';

  @ApiProperty({ example: 'OK', description: 'Transaction remarks.' })
  @IsString()
  @IsNotEmpty()
  Remarks: string = '';
}
