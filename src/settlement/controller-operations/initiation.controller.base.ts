import { Body, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiHeader, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
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
    description: 'Submit settlement payload using both a user access token and a settlement session token. The access token must be sent as a bearer Authorization header and the settlement session token must be sent in the x-settlement-session header.',
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
  @ApiResponse({ status: 201, description: 'Settlement initiated successfully. Returns the created settlement record, merchant and payment breakdown, supplier settlement children, and processing details.', type: SettlementResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid settlement data', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized access token or invalid settlement session token', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Duplicate settlement reference', type: ErrorResponseDto })
  @ApiResponse({ status: 500, description: 'Internal server error during settlement initiation', type: ErrorResponseDto })
  async initiateSettlement(
    @Body() body: InitiateSettlementDto,
    @Headers('x-settlement-session') settlementSessionToken: string,
  ): Promise<SettlementResponseDto> {
    this.logger.log('[SETTLEMENT_REQUEST_PAYLOAD]', body);
    return this.settlementService.initiateSettlement(settlementSessionToken, body);
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
