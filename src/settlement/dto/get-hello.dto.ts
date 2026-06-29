import { ApiProperty } from '@nestjs/swagger';

export class GetHelloDto {
  @ApiProperty({ example: 'hello world' })
  message: string = '';
}
