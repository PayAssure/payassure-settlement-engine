import { Post, Param, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { paymentRecordService } from '../../services/payment-record.service';
import { retailerEscrowTransferService } from '../../../retailer';
import { parseStkCallback } from '../../utils/mpesa-callback.util';
import { toPayoutCallback } from './payout-callback.parser';
import { CallbackContextBase } from './callback-context.base';

export abstract class IdentifierCallbackBase extends CallbackContextBase {
  @Post('callbacks/mpesa/:callbackIdentifier')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive and parse an MPesa callback with a callback identifier and trigger settlement split' })
  async receiveCallbackWithIdentifier(
    @Param('callbackIdentifier') callbackIdentifier: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const timestamp = new Date().toISOString();
    try {
      this.logger.log('[PAYMENT][CALLBACK][RAW]', JSON.stringify({ timestamp, path: req.originalUrl, callbackIdentifier, body: req.body }));
      const payoutCallback = toPayoutCallback(req.body as Record<string, unknown>);
      if (payoutCallback) {
        const payoutResult = await this.settlementService.handleB2bPayoutCallback(payoutCallback, callbackIdentifier);
        return res.status(200).json({ received: true, accepted: true, timestamp, payout: payoutResult });
      }
      const parsed = parseStkCallback(req.body as Record<string, unknown>);
      const result = await paymentRecordService.upsertFromMpesaCallback(req.body as Record<string, unknown>, callbackIdentifier);
      const resolvedMerchantTransactionReference =
        (req.body as any)?.Body?.gatewayPayload?.merchantTransactionReference ??
        (req.body as any)?.merchantTransactionReference ??
        result?.merchantTransactionReference ?? null;
      if (resolvedMerchantTransactionReference) {
        try {
          await retailerEscrowTransferService.handleMpesaFundingCallback(
            String(resolvedMerchantTransactionReference),
            parsed.status === 'completed',
          );
        } catch (escrowError) {
          this.logger.error('[PAYMENT][ESCROW_FUNDING][STK_CALLBACK]', {
            timestamp,
            callbackIdentifier,
            merchantTransactionReference: resolvedMerchantTransactionReference,
            error: escrowError instanceof Error ? escrowError.message : String(escrowError),
          });
        }
      }
      if (!result) {
        this.logger.warn('[PAYMENT][CALLBACK] M-Pesa transaction not found with identifier', {
          timestamp,
          callbackIdentifier,
          checkoutRequestId: parsed.checkoutRequestId,
        });
        return res.status(200).json({ received: true, accepted: false, timestamp, reason: 'Transaction not found in database', parsed });
      }
      if (parsed.status === 'completed') {
        const gatewayPayload = (req.body as any)?.Body?.gatewayPayload;
        const merchantTransactionReference = gatewayPayload?.merchantTransactionReference ?? resolvedMerchantTransactionReference ?? null;
        if (merchantTransactionReference) {
          try {
            const splitResult = await this.settlementService.splitAndAllocateFunds({
              merchantTransactionReference,
              mpesaReceipt: parsed.receipt ?? undefined,
              mpesaCheckoutRequestId: parsed.checkoutRequestId ?? undefined,
              mpesaMerchantRequestId: parsed.merchantRequestId ?? undefined,
              resultCode: parsed.resultCode ?? undefined,
              resultDesc: parsed.resultDesc ?? undefined,
            });
            return res.status(200).json({ received: true, accepted: true, timestamp, parsed, transaction: result, settlement: splitResult });
          } catch (settlementError) {
            const errorMsg = settlementError instanceof Error ? settlementError.message : String(settlementError);
            this.logger.error('[PAYMENT][CALLBACK] settlement split and payout failed', {
              timestamp,
              callbackIdentifier,
              merchantTransactionReference,
              error: errorMsg,
              stack: settlementError instanceof Error ? settlementError.stack : undefined,
            });
            return res.status(200).json({
              received: true,
              accepted: true,
              timestamp,
              parsed,
              transaction: result,
              settlementError: errorMsg,
              note: 'M-Pesa transaction recorded but settlement split and payout failed. Manual intervention may be required.',
            });
          }
        }
        this.logger.warn('[PAYMENT][CALLBACK] no merchant transaction reference found in gateway payload', {
          timestamp,
          callbackIdentifier,
          checkoutRequestId: parsed.checkoutRequestId,
        });
        return res.status(200).json({
          received: true,
          accepted: true,
          timestamp,
          parsed,
          transaction: result,
          note: 'M-Pesa transaction recorded but no settlement reference found for split and payout',
        });
      }
      return res.status(200).json({ received: true, accepted: true, timestamp, parsed, transaction: result });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][CALLBACK] callback with identifier processing failed', {
        timestamp,
        callbackIdentifier,
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return res.status(200).json({ received: true, accepted: false, timestamp, error: errorMsg });
    }
  }
}
