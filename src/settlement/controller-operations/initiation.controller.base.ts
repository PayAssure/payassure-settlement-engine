import { Body, Headers, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiHeader, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import PaymentCallbackDto from '../dto/payment-callback.dto';
import { ErrorResponseDto, SettlementResponseDto } from '../dto/settlement-response.dto';
import { SettlementAuthenticationControllerBase } from './authentication.controller.base';

export abstract class SettlementInitiationControllerBase extends SettlementAuthenticationControllerBase {
  @Post('initiate-settlement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiHeader({ name: 'x-settlement-session', description: 'Settlement session token obtained from settlement authenticate. This is not a bearer token.', required: true })
  @ApiOperation({
    summary: 'Initiate a settlement request',
    description: 'Submit settlement payload using both a user access token and a settlement session token. Returns HTTP 201 as soon as the settlement record is created; validation and processing errors before creation are returned normally. Settlement processing continues asynchronously after acceptance. CASH funding is staged against the retailer DB balance, then supplier and retailer payouts are dispatched from the centralized account without a retailer-to-platform B2B transfer. Mixed CASH/MPESA requests wait for the customer M-Pesa callback before checking and staging the cash portion.',
  })
  @ApiBody({
    description: 'Canonical retailer settlement initiation payload. The retailer supplies supplierAmount and retailerAmount; PayAssure calculates and equally deducts the configured platform fee from both allocations. Do not send platformFee, provider, callbackUrl, or transactionDate.',
    schema: {
      example: {
        merchantId: 'pay_d68f568ddc7d7b2a',
        merchantTransactionReference: 'TXN-MIXED-20260916-000001',
        amount: 127000,
        currency: 'KES',
        payment: { methods: [{ type: 'CASH', amount: 45000 }, { type: 'MPESA', amount: 82000, phoneNumber: '254791614036' }] },
        items: [
          { supplierMerchantId: 'pay_supplier_cement_001', itemReference: 'CEMENT-50KG-001', supplierAmount: 38500, retailerAmount: 3250 },
          { supplierMerchantId: 'pay_supplier_steel_002', itemReference: 'STEEL-BAR-001', supplierAmount: 32500, retailerAmount: 2700 },
          { supplierMerchantId: 'pay_supplier_electrical_003', itemReference: 'ELEC-CABLE-001', supplierAmount: 26500, retailerAmount: 2350 },
          { supplierMerchantId: 'pay_supplier_plumbing_004', itemReference: 'PLUMB-PVC-001', supplierAmount: 19500, retailerAmount: 1700 },
        ],
        metadata: { batchId: 'BATCH-NAIROBI-20260916-001', branchId: 'NRB-WESTLANDS-001', terminalId: 'POS-WL-07', salesAgentId: 'agent-042', invoiceReference: 'INV-WL-20260916-00091' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Settlement created and accepted for asynchronous processing.', type: SettlementResponseDto })
  @ApiResponse({ status: 200, description: 'An existing settlement was found for this merchant transaction reference.', type: SettlementResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid settlement data', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized access token or invalid settlement session token', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Duplicate settlement reference', type: ErrorResponseDto })
  @ApiResponse({ status: 500, description: 'Internal server error during settlement initiation', type: ErrorResponseDto })
  async initiateSettlement(
    @Body() body: InitiateSettlementDto,
    @Headers('x-settlement-session') settlementSessionToken: string,
    @Res() response?: Response,
  ): Promise<SettlementResponseDto> {
    this.logger.log(`[SETTLEMENT_REQUEST_PAYLOAD] ${JSON.stringify(body, null, 2)}`);
    if (!response) {
      const result = await this.settlementService.initiateSettlement(settlementSessionToken, body);
      this.logger.log('[SETTLEMENT_INITIATION_RESPONSE]', result);
      return result;
    }

    let responseSent = false;
    let resolveAccepted!: (acceptedResponse: SettlementResponseDto) => void;
    let rejectBeforeAcceptance!: (error: unknown) => void;
    const accepted = new Promise<SettlementResponseDto>((resolve, reject) => {
      resolveAccepted = resolve;
      rejectBeforeAcceptance = reject;
    });
    const processing = this.settlementService.initiateSettlement(
      settlementSessionToken,
      body,
      async (acceptedResponse, statusCode) => {
        this.logger.log('[SETTLEMENT_INITIATION_RESPONSE]', {
          statusCode,
          body: acceptedResponse,
        });
        await new Promise<void>((resolve) => {
          const finish = () => {
            response.off('finish', finish);
            response.off('close', finish);
            resolve();
          };
          response.once('finish', finish);
          response.once('close', finish);
          response.status(statusCode).json(acceptedResponse);
        });
        responseSent = true;
        resolveAccepted(acceptedResponse);
      },
    );
    void processing.catch((error: unknown) => {
      if (!responseSent) {
        rejectBeforeAcceptance(error);
        return;
      }
      this.logger.error('[SETTLEMENT_PROCESSING_AFTER_ACCEPTANCE_FAILED]', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
    return accepted;
  }

  @Post('payment-callback')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a payment provider callback', description: 'Accepts payment provider callbacks and updates the linked settlement to pending processing.' })
  @ApiResponse({ status: 200, description: 'Payment callback processed successfully.' })
  @ApiResponse({ status: 404, description: 'Settlement was not found for the supplied merchant transaction reference.' })
  async paymentCallback(@Body() body: PaymentCallbackDto): Promise<any> {
    return this.settlementService.handlePaymentCallback(body);
  }
}
