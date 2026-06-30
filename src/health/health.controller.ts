import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('payassure health')
@Controller('payassure')
export class HealthController {
  @Get('health')
  @ApiOperation({ summary: 'Get payassure health status' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  getHealth() {
    return { status: 'ok' };
  }
}
