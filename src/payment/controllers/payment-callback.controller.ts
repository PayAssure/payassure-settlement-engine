import { Controller, Get, Post, Req, Res, Param } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { paymentRecordService } from '../services/payment-record.service';
import { parseStkCallback } from '../utils/mpesa-callback.util';
import { SettlementService } from '../../settlement/settlement.service';
import { Logger } from '@nestjs/common';

@ApiTags('Payments')
@Controller('payments')
export class PaymentCallbackController {
  private readonly logger = new Logger(PaymentCallbackController.name);

  constructor(private readonly settlementService: SettlementService) {}

  @Post('callbacks/mpesa')
  @ApiOperation({ summary: 'Receive and parse an M-Pesa callback' })
  @ApiResponse({ status: 200, description: 'Callback received and processed successfully' })
  @ApiResponse({ status: 500, description: 'Failed to process callback' })
  async receiveCallback(@Req() req: Request, @Res() res: Response) {
    const callbackIdentifier = (req.params as any).callbackIdentifier ?? null;
    const timestamp = new Date().toISOString();

    this.logger.log('[PAYMENT][CALLBACK] received M-Pesa callback', {
      timestamp,
      method: req.method,
      path: req.originalUrl,
      callbackIdentifier,
      bodySize: JSON.stringify(req.body).length,
    });

    try {
      // Step 1: Parse the M-Pesa callback
      const parsed = parseStkCallback(req.body as Record<string, unknown>);
      this.logger.log('[PAYMENT][CALLBACK] M-Pesa callback parsed', {
        timestamp,
        status: parsed.status,
        resultCode: parsed.resultCode,
        resultDesc: parsed.resultDesc,
        checkoutRequestId: parsed.checkoutRequestId,
        merchantRequestId: parsed.merchantRequestId,
        receipt: parsed.receipt,
      });

      // Step 2: Update M-Pesa transaction record in database
      const transactionResult = await paymentRecordService.upsertFromMpesaCallback(
        req.body as Record<string, unknown>,
        callbackIdentifier,
      );

      const resolvedMerchantTransactionReference =
        (req.body as any)?.Body?.gatewayPayload?.merchantTransactionReference ??
        (req.body as any)?.merchantTransactionReference ??
        transactionResult?.merchantTransactionReference ??
        null;

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

      this.logger.log('[PAYMENT][CALLBACK] M-Pesa transaction record updated', {
        timestamp,
        transactionId: transactionResult.id,
        status: transactionResult.status,
      });

      // Step 3: If payment was successful, call settlement split endpoint
      if (parsed.status === 'completed') {
        this.logger.log('[PAYMENT][CALLBACK] payment successful - calling settlement split endpoint', {
          timestamp,
          transactionId: transactionResult.id,
          checkoutRequestId: parsed.checkoutRequestId,
        });

        const gatewayPayload = (req.body as any)?.Body?.gatewayPayload;
        const merchantTransactionReference =
          gatewayPayload?.merchantTransactionReference ??
          resolvedMerchantTransactionReference ??
          null;

        if (merchantTransactionReference) {
          try {
            // Call settlement split endpoint - this will handle all the splitting logic
            this.logger.log('[PAYMENT][CALLBACK] callback lookup resolved merchant reference', {
              timestamp,
              callbackIdentifier,
              checkoutRequestId: parsed.checkoutRequestId,
              merchantTransactionReference,
              storedInDb: transactionResult?.merchantTransactionReference ?? null,
            });

            this.logger.log('[PAYMENT][CALLBACK] invoking settlement split and allocation', {
              timestamp,
              merchantTransactionReference,
              mpesaReceipt: parsed.receipt,
            });

            const splitResult = await this.settlementService.splitAndAllocateFunds({
              merchantTransactionReference,
              mpesaReceipt: parsed.receipt ?? undefined,
              mpesaCheckoutRequestId: parsed.checkoutRequestId ?? undefined,
              mpesaMerchantRequestId: parsed.merchantRequestId ?? undefined,
              resultCode: parsed.resultCode ?? undefined,
              resultDesc: parsed.resultDesc ?? undefined,
            });

            this.logger.log('[PAYMENT][CALLBACK] settlement split and allocation completed', {
              timestamp,
              merchantTransactionReference,
              splitResult,
            });

            return res.status(200).json({
              received: true,
              accepted: true,
              timestamp,
              parsed,
              transaction: transactionResult,
              settlement: splitResult,
            });
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
        } else {
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
      }

      // If payment failed, just acknowledge receipt
      this.logger.log('[PAYMENT][CALLBACK] payment failed - not invoking settlement', {
        timestamp,
        status: parsed.status,
        resultCode: parsed.resultCode,
        resultDesc: parsed.resultDesc,
      });

      return res.status(200).json({
        received: true,
        accepted: true,
        timestamp,
        parsed,
        transaction: transactionResult,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][CALLBACK] callback processing failed', {
        timestamp,
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return res.status(200).json({
        received: true,
        accepted: false,
        timestamp,
        error: errorMsg,
      });
    }
  }

  @Get('callbacks/mpesa')
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

  @Post('callbacks/mpesa/:callbackIdentifier')
  @ApiOperation({ summary: 'Receive and parse an MPesa callback with a callback identifier and trigger settlement split' })
  async receiveCallbackWithIdentifier(
    @Param('callbackIdentifier') callbackIdentifier: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const timestamp = new Date().toISOString();
    this.logger.log('[PAYMENT][CALLBACK] received M-Pesa callback with identifier', {
      timestamp,
      callbackIdentifier,
      bodySize: JSON.stringify(req.body).length,
    });

    try {
      this.logger.log('[PAYMENT][CALLBACK][RAW] exact callback payload received from MPesa', {
        timestamp,
        callbackIdentifier,
        rawCallbackBody: req.body,
      });

      // Step 1: Parse the M-Pesa callback
      const parsed = parseStkCallback(req.body as Record<string, unknown>);
      this.logger.log('[PAYMENT][CALLBACK] M-Pesa callback parsed', {
        timestamp,
        callbackIdentifier,
        status: parsed.status,
        resultCode: parsed.resultCode,
        checkoutRequestId: parsed.checkoutRequestId,
        receipt: parsed.receipt,
      });

      // Step 2: Update M-Pesa transaction record
      const result = await paymentRecordService.upsertFromMpesaCallback(
        req.body as Record<string, unknown>,
        callbackIdentifier,
      );

      const resolvedMerchantTransactionReference =
        (req.body as any)?.Body?.gatewayPayload?.merchantTransactionReference ??
        (req.body as any)?.merchantTransactionReference ??
        result?.merchantTransactionReference ??
        null;

      if (!result) {
        this.logger.warn('[PAYMENT][CALLBACK] M-Pesa transaction not found with identifier', {
          timestamp,
          callbackIdentifier,
          checkoutRequestId: parsed.checkoutRequestId,
        });
        return res.status(200).json({
          received: true,
          accepted: false,
          timestamp,
          reason: 'Transaction not found in database',
          parsed,
        });
      }

      this.logger.log('[PAYMENT][CALLBACK] M-Pesa transaction record updated', {
        timestamp,
        callbackIdentifier,
        transactionId: result.id,
        status: result.status,
      });

      this.logger.log('[PAYMENT][CALLBACK][MAPPING] callback to settlement mapping', {
        timestamp,
        callbackIdentifier,
        checkoutRequestId: parsed.checkoutRequestId,
        merchantRequestId: parsed.merchantRequestId,
        receipt: parsed.receipt,
        resolvedMerchantTransactionReference: resolvedMerchantTransactionReference,
        storedInDb: result?.merchantTransactionReference ?? null,
      });

      // Step 3: If payment was successful, trigger settlement split
      if (parsed.status === 'completed') {
        this.logger.log('[PAYMENT][CALLBACK] payment successful - triggering settlement split and payout', {
          timestamp,
          callbackIdentifier,
          transactionId: result.id,
          checkoutRequestId: parsed.checkoutRequestId,
        });

        const gatewayPayload = (req.body as any)?.Body?.gatewayPayload;
        const merchantTransactionReference =
          gatewayPayload?.merchantTransactionReference ??
          resolvedMerchantTransactionReference ??
          null;

        if (merchantTransactionReference) {
          try {
            this.logger.log('[PAYMENT][CALLBACK] callback lookup resolved merchant reference', {
              timestamp,
              callbackIdentifier,
              checkoutRequestId: parsed.checkoutRequestId,
              merchantTransactionReference,
              storedInDb: result?.merchantTransactionReference ?? null,
            });

            this.logger.log('[PAYMENT][CALLBACK] invoking settlement split and payout dispatch', {
              timestamp,
              callbackIdentifier,
              merchantTransactionReference,
              mpesaReceipt: parsed.receipt,
            });

            // Call settlement split endpoint which will handle all splitting and payout logic
            const splitResult = await this.settlementService.splitAndAllocateFunds({
              merchantTransactionReference,
              mpesaReceipt: parsed.receipt ?? undefined,
              mpesaCheckoutRequestId: parsed.checkoutRequestId ?? undefined,
              mpesaMerchantRequestId: parsed.merchantRequestId ?? undefined,
              resultCode: parsed.resultCode ?? undefined,
              resultDesc: parsed.resultDesc ?? undefined,
            });

            this.logger.log('[PAYMENT][CALLBACK] settlement split and payout dispatch completed', {
              timestamp,
              callbackIdentifier,
              merchantTransactionReference,
              settlementId: splitResult.settlementId,
              supplierPayoutStatus: splitResult.dispatchResults?.supplier?.status ?? 'FAILED',
              retailerPayoutStatus: splitResult.dispatchResults?.retailer?.status ?? 'FAILED',
              hasErrors: (splitResult.errors?.length ?? 0) > 0,
            });

            return res.status(200).json({
              received: true,
              accepted: true,
              timestamp,
              parsed,
              transaction: result,
              settlement: splitResult,
            });
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
        } else {
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
      }

      // If payment failed, just acknowledge receipt
      this.logger.log('[PAYMENT][CALLBACK] payment failed - not invoking settlement split', {
        timestamp,
        callbackIdentifier,
        status: parsed.status,
        resultCode: parsed.resultCode,
        resultDesc: parsed.resultDesc,
      });

      return res.status(200).json({
        received: true,
        accepted: true,
        timestamp,
        parsed,
        transaction: result,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][CALLBACK] callback with identifier processing failed', {
        timestamp,
        callbackIdentifier,
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return res.status(200).json({
        received: true,
        accepted: false,
        timestamp,
        error: errorMsg,
      });
    }
  }
}
