import { Body, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import * as crypto from 'crypto';
import PaymentConfirmationDto from '../dto/payment-confirmation.dto';
import { SettlementInitiationControllerBase } from './initiation.controller.base';

export abstract class PaymentConfirmationControllerBase extends SettlementInitiationControllerBase {
  @Post('payment-confirmation')
  @ApiOperation({ summary: 'Confirm that a settlement was paid by the customer', description: 'Accepts an internal payment confirmation payload from the merged payment + settlement engine and advances the settlement into ledger allocation and payout processing.' })
  @ApiResponse({ status: 200, description: 'Payment confirmation processed successfully.' })
  @ApiResponse({ status: 404, description: 'Settlement was not found for the supplied identifier.' })
  async confirmSettlementPayment(@Body() body: PaymentConfirmationDto, @Headers() headers: Record<string, string | string[] | undefined>): Promise<any> {
    const authorization = this.getHeaderValue(headers, 'authorization') ?? this.getHeaderValue(headers, 'Authorization');
    const signature = this.getHeaderValue(headers, 'x-payassure-signature') ?? this.getHeaderValue(headers, 'X-PayAssure-Signature');
    const timestamp = this.getHeaderValue(headers, 'x-payassure-timestamp') ?? this.getHeaderValue(headers, 'X-PayAssure-Timestamp');
    const expectedToken = process.env.PAYMENT_GATEWAY_API_TOKEN || process.env.SETTLEMENT_API_TOKEN || process.env.INTERNAL_GATEWAY_TOKEN;
    const expectedSecret = process.env.PAYMENT_GATEWAY_SIGNATURE_SECRET || process.env.SETTLEMENT_SIGNATURE_SECRET || process.env.PAYASSURE_INTERNAL_SECRET;
    if (!authorization || !authorization.startsWith('Bearer ')) {
      this.logger.warn(`[CONFIRMATION][AUTH] missing or malformed bearer token for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Missing bearer token', error: 'UNAUTHORIZED' });
    }
    if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
      this.logger.warn(`[CONFIRMATION][AUTH] invalid bearer token for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid bearer token', error: 'UNAUTHORIZED' });
    }
    if (!expectedSecret) {
      this.logger.warn(`[CONFIRMATION][AUTH] signature secret not configured for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Signature secret is not configured', error: 'UNAUTHORIZED' });
    }
    if (!signature || !timestamp) {
      this.logger.warn(`[CONFIRMATION][AUTH] missing signature headers for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Missing signature headers', error: 'UNAUTHORIZED' });
    }
    const signatureBody = {
      paymentId: body.paymentId,
      settlementId: body.settlementId,
      status: body.status,
      provider: body.provider,
      paidAmount: body.paidAmount,
      paidAt: body.paidAt,
    } as Record<string, unknown>;
    const bodyString = JSON.stringify(signatureBody);
    const expectedSignature = crypto.createHmac('sha256', expectedSecret).update(bodyString).digest('hex');
    if (expectedSignature !== signature) {
      const authMethod = authorization ? String(authorization).split(' ')[0] : 'missing';
      this.logger.warn(
        `[CONFIRMATION][AUTH] signature mismatch for ${body.settlementId}: expected=${expectedSignature} presentedSignature=${signature} authentication=${authMethod} token=${authorization} signingMethod=crypto.createHmac('sha256', secret).update(bodyString).digest('hex') bodyString=${bodyString} algorithm=HMAC-SHA256 timestamp=${timestamp}`,
      );
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid signature', error: 'UNAUTHORIZED' });
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const receivedTimestamp = Number(timestamp);
    if (!Number.isFinite(receivedTimestamp) || Math.abs(nowSeconds - receivedTimestamp) > 300) {
      this.logger.warn(`[CONFIRMATION][AUTH] stale timestamp ${timestamp} for ${body.settlementId}`);
      throw new UnauthorizedException({ statusCode: 401, message: 'Expired or invalid timestamp', error: 'UNAUTHORIZED' });
    }
    return this.settlementService.confirmSettlementPayment(body);
  }

  @Post('internal/settlements/payment-confirmation')
  @ApiOperation({ summary: 'Legacy internal payment confirmation route', description: 'Alias kept for compatibility with internal settlement confirmation callers.' })
  async confirmSettlementPaymentInternal(@Body() body: PaymentConfirmationDto, @Headers() headers: Record<string, string | string[] | undefined>): Promise<any> {
    return this.confirmSettlementPayment(body, headers);
  }

  protected getHeaderValue(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
    const value = headers[key];
    return Array.isArray(value) ? value[0] : value;
  }
}
