import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticateDto } from './dto/authenticate.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettlementService } from './settlement.service';

@ApiTags('supplier')
@Controller('supplier')
export class SupplierController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post('authenticate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Authenticate a supplier with API credentials', description: 'Validates supplier API credentials and issues a supplier session token for settlement lookups.' })
  @ApiResponse({ status: 200, description: 'Supplier authentication succeeded.' })
  async authenticate(@Body() body: AuthenticateDto, @Req() req: any) {
    return this.settlementService.authenticateSupplier(body, req.user);
  }

  @Get('settlements')
  @ApiHeader({ name: 'x-supplier-session', description: 'Supplier session token returned from supplier authentication.', required: true })
  @ApiOperation({ summary: 'List supplier settlements', description: 'Returns only child settlements allocated to the authenticated supplier.' })
  @ApiResponse({ status: 200, description: 'Supplier settlements returned successfully.' })
  async getSettlements(@Headers('x-supplier-session') sessionToken: string) {
    return this.settlementService.getSupplierSettlements(sessionToken);
  }
}
