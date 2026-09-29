import { Get, Param, Put, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { retailerEscrowTransferService } from '../../retailer';
import { RetailerEscrowFloatDto } from '../dto/retailer-escrow-float.dto';
import { assertAdministrator } from './assert-administrator';
import { EscrowReadControllerBase } from './escrow-read.controller.base';

export abstract class RetailerFloatControllerBase extends EscrowReadControllerBase {
  @Get('history')
  history() {
    return this.escrowIntelligenceService.getReconciliationHistory();
  }

  @Get('retailers/:merchantId/float')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get a retailer escrow float configuration' })
  @ApiResponse({ status: 200, description: 'Daily float and current expected remaining balance' })
  @ApiResponse({ status: 403, description: 'Only administrators can view retailer float configuration' })
  async getRetailerFloat(@Param('merchantId') merchantId: string, @Req() request: any) {
    assertAdministrator(request.user);
    return retailerEscrowTransferService.getFloat(merchantId);
  }

  @Put('retailers/:merchantId/float')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Add or edit a retailer escrow float configuration',
    description: 'Initial setup defaults expectedRemainingBalance to dailyFloat. Editing dailyFloat preserves the current remainder unless expectedRemainingBalance is explicitly provided.',
  })
  @ApiResponse({ status: 200, description: 'Retailer float configuration saved' })
  @ApiResponse({ status: 403, description: 'Only administrators can edit retailer float configuration' })
  @ApiResponse({ status: 409, description: 'A transfer is in progress for this retailer' })
  async setRetailerFloat(@Param('merchantId') merchantId: string, @Body() body: RetailerEscrowFloatDto, @Req() request: any) {
    assertAdministrator(request.user);
    return retailerEscrowTransferService.setFloat(merchantId, body.dailyFloat, body.expectedRemainingBalance);
  }
}
