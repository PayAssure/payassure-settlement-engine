import { Get, NotFoundException, Param, Put, Body, Req, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { retailerEscrowTransferService, retailerFloatDepositService } from '../../retailer';
import { retailerEscrowReconciliationService } from '../../retailer';
import { retailerEscrowBalanceService } from '../../retailer';
import { RetailerEscrowFloatDto } from '../dto/retailer-escrow-float.dto';
import { RetailerFloatDepositDto } from '../dto/retailer-float-deposit.dto';
import { assertAdministrator } from './assert-administrator';
import { EscrowReadControllerBase } from './escrow-read.controller.base';

export abstract class RetailerFloatControllerBase extends EscrowReadControllerBase {
  @Get('history')
  history() {
    return this.escrowIntelligenceService.getReconciliationHistory();
  }

  @Get('retailer/float/reconciliations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get recent shared escrow balance reconciliation results' })
  async getRetailerEscrowReconciliations(@Req() request: any) {
    assertAdministrator(request.user);
    return retailerEscrowReconciliationService.getRecentResults();
  }

  @Get('retailer/float')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the authenticated retailer escrow float configuration', description: 'The retailer merchant ID is resolved from the authenticated bearer token.' })
  @ApiResponse({ status: 200, description: 'Daily float and current expected remaining balance' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to this retailer' })
  async getRetailerFloat(@Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    return retailerEscrowTransferService.getFloat(merchantId);
  }

  @Post('retailer/float/balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Check the authenticated retailer escrow account balance',
    description: 'Submits a general M-Pesa Account Balance query for the authenticated retailer account. Safaricom returns the balance asynchronously to the retailer escrow balance callback.',
  })
  @ApiResponse({ status: 201, description: 'Retailer escrow account balance query submitted; the actual balance is delivered asynchronously to the callback' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to this retailer' })
  @ApiResponse({ status: 404, description: 'Retailer float configuration not found' })
  async checkRetailerFloatBalance(@Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    if (!await retailerEscrowTransferService.hasFloatConfig(merchantId)) {
      throw new NotFoundException(`Escrow float is not configured for retailer ${merchantId}`);
    }
    return retailerEscrowBalanceService.queryBalance(
      'retailer-escrow-balance',
      'retailer-escrow-balance-timeout',
      { retailerMerchantId: merchantId },
    );
  }

  @Put('retailers/:merchantId/float')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Add or edit a retailer escrow float configuration',
    description: 'Configures daily float metadata and location. Available balance is derived only from successful deposit and settlement callbacks and cannot be set through this endpoint.',
  })
  @ApiResponse({ status: 200, description: 'Retailer float configuration saved' })
  @ApiResponse({ status: 403, description: 'Only administrators can edit retailer float configuration' })
  @ApiResponse({ status: 409, description: 'A transfer is in progress for this retailer' })
  async setRetailerFloat(@Param('merchantId') merchantId: string, @Body() body: RetailerEscrowFloatDto, @Req() request: any) {
    assertAdministrator(request.user);
    return retailerEscrowTransferService.setFloat(merchantId, body.dailyFloat, body.tillNumber, body.storeNumber);
  }

  @Post('retailer/float/deposits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate a retailer escrow float deposit',
    description: 'Starts an STK Push using the authenticated retailer M-Pesa credentials. The expected float balance changes only after a successful M-Pesa callback.',
  })
  @ApiResponse({ status: 201, description: 'Retailer float deposit STK Push submitted' })
  @ApiResponse({ status: 400, description: 'Invalid amount or payer phone number' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to this retailer' })
  @ApiResponse({ status: 404, description: 'Retailer or float configuration not found' })
  async depositRetailerFloat(@Body() body: RetailerFloatDepositDto, @Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    return retailerFloatDepositService.initiate(merchantId, body.amount, body.payerPhoneNumber);
  }
}
