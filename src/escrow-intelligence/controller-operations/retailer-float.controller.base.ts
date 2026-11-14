import { Get, Param, Put, Body, Req, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { retailerEscrowTransferService, retailerFloatDepositService } from '../../retailer';
import { retailerEscrowReconciliationService } from '../../retailer';
import { RetailerEscrowFloatDto } from '../dto/retailer-escrow-float.dto';
import { RetailerEscrowTransferDto } from '../dto/retailer-escrow-transfer.dto';
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
  @ApiResponse({
    status: 200,
    description: 'Daily float configuration and database-derived balance; no till or store fields are returned.',
    schema: {
      example: {
        merchantId: 'pay_retailer_001',
        currency: 'KES',
        dailyFloat: 10000,
        depositedBalance: 12500,
        paidOutBalance: 2000,
        reservedBalance: 1500,
        availableBalance: 9000,
        updatedAt: '2026-11-04T12:19:29.795Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to this retailer' })
  @ApiResponse({ status: 404, description: 'Retailer float configuration not found' })
  async getRetailerFloat(@Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    return retailerEscrowTransferService.getFloat(merchantId);
  }

  @Get('retailer/float/balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the authenticated retailer virtual balance from the database',
    description: 'Returns successful deposits, completed payouts, reserved transfers, and available balance from PayAssure records. This does not query Safaricom.',
  })
  @ApiResponse({
    status: 200,
    description: 'Database-derived retailer virtual balance; this endpoint does not query Safaricom.',
    schema: {
      example: {
        merchantId: 'pay_retailer_001',
        currency: 'KES',
        dailyFloat: 10000,
        depositedBalance: 12500,
        paidOutBalance: 2000,
        reservedBalance: 1500,
        availableBalance: 9000,
        asOf: '2026-11-04T12:19:29.795Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to this retailer' })
  @ApiResponse({ status: 404, description: 'Retailer float configuration not found' })
  async getRetailerVirtualBalance(@Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    return retailerEscrowTransferService.getBalance(merchantId);
  }

  @Post('retailer/float/balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the authenticated retailer virtual balance from the database',
    description: 'Returns the authenticated retailer’s successful deposits, completed payouts, reserved transfers, and available balance from PayAssure records. This compatibility POST route does not query Safaricom.',
  })
  @ApiResponse({
    status: 201,
    description: 'Database-derived balance for the authenticated retailer; no M-Pesa Account Balance request is made.',
    schema: {
      example: {
        merchantId: 'pay_retailer_001',
        currency: 'KES',
        dailyFloat: 10000,
        depositedBalance: 12500,
        paidOutBalance: 2000,
        reservedBalance: 1500,
        availableBalance: 9000,
        asOf: '2026-11-04T12:19:29.795Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to this retailer' })
  @ApiResponse({ status: 404, description: 'Retailer float configuration not found' })
  async checkRetailerFloatBalance(@Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    return retailerEscrowTransferService.getBalance(merchantId);
  }

  @Put('retailers/:merchantId/float')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Add or edit a retailer escrow float configuration',
    description: 'Configures daily float metadata only. Till and store fields are not used. Available balance is derived only from successful deposit and settlement callbacks and cannot be set through this endpoint.',
  })
  @ApiBody({ type: RetailerEscrowFloatDto })
  @ApiResponse({ status: 200, description: 'Retailer float configuration saved' })
  @ApiResponse({ status: 403, description: 'Only administrators can edit retailer float configuration' })
  @ApiResponse({ status: 409, description: 'A transfer is in progress for this retailer' })
  async setRetailerFloat(@Param('merchantId') merchantId: string, @Body() body: RetailerEscrowFloatDto, @Req() request: any) {
    assertAdministrator(request.user);
    return retailerEscrowTransferService.setFloat(merchantId, body.dailyFloat);
  }

  @Post('retailer/float/deposits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate a retailer escrow float deposit',
    description: 'Starts a PayBill STK Push using the authenticated retailer M-Pesa credentials. MPESA_RETAILER_SHORTCODE is sent as BusinessShortCode and PartyB; the normalized payer phone is sent as PartyA and PhoneNumber. The expected float balance changes only after a successful M-Pesa callback.',
  })
  @ApiBody({ type: RetailerFloatDepositDto })
  @ApiResponse({
    status: 201,
    description: 'Retailer PayBill STK Push submitted; this does not credit the virtual balance until callback confirmation.',
    schema: {
      example: {
        depositId: 'clx_float_deposit_001',
        merchantId: 'pay_retailer_001',
        amount: 5000,
        payerPhoneNumber: '254791614036',
        status: 'SUBMITTED',
        merchantRequestId: 'ws_CO_001',
        checkoutRequestId: 'ws_CO_001',
        responseCode: '0',
        responseDescription: 'Success. Request accepted for processing',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid amount or payer phone number' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to this retailer' })
  @ApiResponse({ status: 404, description: 'Retailer or float configuration not found' })
  async depositRetailerFloat(@Body() body: RetailerFloatDepositDto, @Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    return retailerFloatDepositService.initiate(merchantId, body.amount, body.payerPhoneNumber);
  }

  @Post('retailer/float/transfers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Transfer retailer escrow funds to the main PayAssure M-Pesa account',
    description: 'Initiates a B2B transfer for the authenticated retailer. The transfer ID and transaction reference are generated by the server. Multiple transfers may be pending at once; their amounts are reserved against the available escrow balance to prevent overspending. A transfer is only deducted after Safaricom confirms success.',
  })
  @ApiBody({ type: RetailerEscrowTransferDto })
  @ApiResponse({ status: 201, description: 'B2B escrow transfer submitted with server-generated transfer ID and transaction reference' })
  @ApiResponse({ status: 400, description: 'Amount must be a positive whole number of KES' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to an active or live retailer' })
  @ApiResponse({ status: 404, description: 'Retailer escrow float is not configured' })
  async initiateRetailerEscrowB2bTransfer(@Body() body: RetailerEscrowTransferDto, @Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    return retailerEscrowTransferService.startStandaloneTransfer(merchantId, body.amount);
  }
}
