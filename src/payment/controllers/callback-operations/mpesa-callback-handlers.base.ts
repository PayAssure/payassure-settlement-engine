import { Get, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { paymentRecordService } from '../../services/payment-record.service';
import { retailerEscrowTransferService } from '../../../retailer';
import { parseStkCallback } from '../../utils/mpesa-callback.util';
import { toPayoutCallback } from './payout-callback.parser';
import { EscrowBalanceCallbacksBase } from './escrow-balance-callbacks.base';

export abstract class MpesaCallbackHandlersBase extends EscrowBalanceCallbacksBase {
  @Post('callbacks/mpesa')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive and parse an M-Pesa callback' })
  @ApiResponse({ status: 200, description: 'Callback received and processed successfully' })
  @ApiResponse({ status: 500, description: 'Failed to process callback' })
  async receiveCallback(@Req() req: Request, @Res() res: Response) {
    const callbackIdentifier = (req.params as any).callbackIdentifier ?? null;
    const timestamp = new Date().toISOString();
    try {
      this.logger.log('[PAYMENT][CALLBACK][RAW]', JSON.stringify({ timestamp, path: req.originalUrl, callbackIdentifier, body: req.body }));
      const payoutCallback = toPayoutCallback(req.body as Record<string, unknown>);
      if (payoutCallback) {
        const payoutResult = await this.settlementService.handleB2bPayoutCallback(payoutCallback);
        return res.status(200).json({ received: true, accepted: true, timestamp, payout: payoutResult });
      }
      const parsed = parseStkCallback(req.body as Record<string, unknown>);
      const transactionResult = await paymentRecordService.upsertFromMpesaCallback(req.body as Record<string, unknown>, callbackIdentifier);
      const resolvedMerchantTransactionReference =
        (req.body as any)?.Body?.gatewayPayload?.merchantTransactionReference ??
        (req.body as any)?.merchantTransactionReference ??
        transactionResult?.merchantTransactionReference ?? null;
      if (resolvedMerchantTransactionReference) {
        try {
          await retailerEscrowTransferService.handleMpesaFundingCallback(
            String(resolvedMerchantTransactionReference),
            parsed.status === 'completed',
          );
        } catch (escrowError) {
          this.logger.error('[PAYMENT][ESCROW_FUNDING][STK_CALLBACK]', {
            timestamp,
            merchantTransactionReference: resolvedMerchantTransactionReference,
            error: escrowError instanceof Error ? escrowError.message : String(escrowError),
          });
        }
      }
      if (!transactionResult) {
        this.logger.warn('[PAYMENT][CALLBACK] M-Pesa transaction not found in database', {
          timestamp,
          callbackIdentifier,
          checkoutRequestId: parsed.checkoutRequestId,
        });
        return res.status(200).json({
          received: true,
          accepted: false,
          reason: 'M-Pesa transaction not found in database',
          timestamp,
          parsed,
        });
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
            return res.status(200).json({ received: true, accepted: true, timestamp, parsed, transaction: transactionResult, settlement: splitResult });
          } catch (settlementError) {
            const errorMsg = settlementError instanceof Error ? settlementError.message : String(settlementError);
            this.logger.error('[PAYMENT][CALLBACK] settlement split failed', {
              timestamp,
              merchantTransactionReference,
              error: errorMsg,
              stack: settlementError instanceof Error ? settlementError.stack : undefined,
            });
            return res.status(200).json({
              received: true,
              accepted: true,
              timestamp,
              parsed,
              transaction: transactionResult,
              settlementError: errorMsg,
              note: 'M-Pesa transaction recorded but settlement split failed. Manual intervention may be required.',
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
          transaction: transactionResult,
          note: 'M-Pesa transaction recorded but no settlement reference to process',
        });
      }
      return res.status(200).json({ received: true, accepted: true, timestamp, parsed, transaction: transactionResult });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][CALLBACK] callback processing failed', {
        timestamp,
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return res.status(200).json({ received: true, accepted: false, timestamp, error: errorMsg });
    }
  }

  @Get('callbacks/mpesa')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Health/read endpoint for MPesa callback verification' })
  @ApiResponse({ status: 200, description: 'Callback endpoint is active and ready' })
  async receiveCallbackGet(@Req() req: Request, @Res() res: Response) {
    res.status(200).json({
      ok: true,
      message: 'MPesa callback endpoint is active',
      timestamp: new Date().toISOString(),
      query: req.query,
    });
  }

  @Post('callbacks/mpesa/account-balance')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive an M-Pesa account balance result', description: 'Safaricom posts the asynchronous account balance result here after an account-balance query.' })
  @ApiResponse({ status: 200, description: 'Account balance result received and acknowledged' })
  async receiveAccountBalanceCallback(@Req() req: Request, @Res() res: Response) {
    const timestamp = new Date().toISOString();
    this.logger.log('[PAYMENT][ACCOUNT_BALANCE][CALLBACK]', JSON.stringify({ timestamp, body: req.body }));
    return res.status(200).json({ Result: { ResultCode: '0', ResultDesc: 'Account balance result received' } });
  }
}
