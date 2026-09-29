import { Body, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AuthenticateDto } from '../dto/authenticate.dto';
import { AuthenticateResponseDto } from '../dto/settlement-response.dto';
import { SettlementControllerContextBase } from './controller-context.base';

export abstract class SettlementAuthenticationControllerBase extends SettlementControllerContextBase {
  @Post('authenticate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Authenticate business with API credentials',
    description: 'Verify API key and secret to receive a one-time token for settlement operations. Token expires in 1 hour and can only be used once.',
  })
  @ApiResponse({ status: 200, description: 'Authentication successful. Returns a one-time token and business profile details. Use this token in the x-settlement-session header for the initiate endpoint.', type: AuthenticateResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid API credentials' })
  @ApiResponse({ status: 404, description: 'Business not found' })
  @ApiResponse({ status: 403, description: 'Business account not in LIVE status' })
  async authenticate(@Body() body: AuthenticateDto, @Req() req: any): Promise<AuthenticateResponseDto> {
    return this.settlementService.authenticate(body, req.user);
  }

  async authenticateSupplier(@Body() body: AuthenticateDto, @Req() req: any) {
    return this.settlementService.authenticateSupplier(body, req?.user ?? req);
  }

  async getSupplierSettlements(sessionToken: string) {
    return this.settlementService.getSupplierSettlements(sessionToken);
  }
}
