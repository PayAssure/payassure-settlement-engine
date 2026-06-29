import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { GetHelloDto } from './dto/get-hello.dto';

@ApiTags('settlement')
@Controller('settlement')
export class SettlementController {
  constructor(private readonly service: SettlementService) {}

  @Get('hello')
  @ApiOperation({ summary: 'Get hello from database' })
  @ApiResponse({ status: 200, type: GetHelloDto })
  async getHello(): Promise<GetHelloDto> {
    const text = await this.service.getHelloText();
    return { message: text };
  }
}
