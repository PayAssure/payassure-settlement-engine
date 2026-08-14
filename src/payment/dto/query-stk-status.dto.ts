import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export default class QueryStkStatusDto {
  @ApiProperty({
    example: 'ws_CO_28032023120122793434',
    description: 'Checkout request ID returned from the STK push initiation response',
  })
  @IsString()
  @IsNotEmpty()
  checkoutRequestId: string = '';
}
