import { Controller, Get, Post, Req, Res, Param } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { paymentRecordService } from '../services/payment-record.service';
import { retailerEscrowTransferService } from '../services/retailer-escrow-transfer.service';
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

    try {
      this.logger.log('[PAYMENT][CALLBACK][RAW]', JSON.stringify({
        timestamp,
        path: req.originalUrl,
        callbackIdentifier,
        body: req.body,
      }));

      const payoutCallback = this.toPayoutCallback(req.body as Record<string, unknown>);
      if (payoutCallback) {
        const payoutResult = await this.settlementService.handleB2bPayoutCallback(payoutCallback);
        return res.status(200).json({ received: true, accepted: true, timestamp, payout: payoutResult });
      }

      // Step 1: Parse the M-Pesa callback
      const parsed = parseStkCallback(req.body as Record<string, unknown>);
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

      // Step 3: If payment was successful, call settlement split endpoint
      if (parsed.status === 'completed') {
        const gatewayPayload = (req.body as any)?.Body?.gatewayPayload;
        const merchantTransactionReference =
          gatewayPayload?.merchantTransactionReference ??
          resolvedMerchantTransactionReference ??
          null;

        if (merchantTransactionReference) {
          try {
            // Call settlement split endpoint - this will handle all the splitting logic
            const splitResult = await this.settlementService.splitAndAllocateFunds({
              merchantTransactionReference,
              mpesaReceipt: parsed.receipt ?? undefined,
              mpesaCheckoutRequestId: parsed.checkoutRequestId ?? undefined,
              mpesaMerchantRequestId: parsed.merchantRequestId ?? undefined,
              resultCode: parsed.resultCode ?? undefined,
              resultDesc: parsed.resultDesc ?? undefined,
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

  @Post('callbacks/mpesa/account-balance')
  @ApiOperation({
    summary: 'Receive an M-Pesa account balance result',
    description: 'Safaricom posts the asynchronous account balance result here after an account-balance query.',
  })
  @ApiResponse({ status: 200, description: 'Account balance result received and acknowledged' })
  async receiveAccountBalanceCallback(@Req() req: Request, @Res() res: Response) {
    const timestamp = new Date().toISOString();
    this.logger.log('[PAYMENT][ACCOUNT_BALANCE][CALLBACK]', JSON.stringify({
      timestamp,
      body: req.body,
    }));

    return res.status(200).json({
      Result: {
        ResultCode: 0,
        ResultDesc: 'Account balance result received',
      },
    });
  }

  @Post('callbacks/mpesa/escrow-balance/:transferId')
  @ApiOperation({
    summary: 'Receive a retailer escrow balance result',
    description: 'Validates the retailer account balance against its stored expected remainder. A valid result starts the CASH transfer flow.',
  })
  @ApiResponse({ status: 200, description: 'Escrow balance callback received and acknowledged' })
  async receiveEscrowBalanceCallback(
    @Param('transferId') transferId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const processing = await retailerEscrowTransferService.handleBalanceCallback(
        transferId,
        req.body as Record<string, unknown>,
      );
      return res.status(200).json({
        Result: { ResultCode: 0, ResultDesc: 'Escrow balance callback received' },
        processing,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_BALANCE][CALLBACK]', { transferId, error: reason });
      return res.status(200).json({
        Result: { ResultCode: 0, ResultDesc: 'Escrow balance callback received' },
        accepted: false,
        reason,
      });
    }
  }

  @Post('callbacks/mpesa/escrow-balance-timeout/:transferId')
  @ApiOperation({ summary: 'Receive a retailer escrow balance query timeout' })
  @ApiResponse({ status: 200, description: 'Balance timeout callback acknowledged; the pending check is failed safely' })
  async receiveEscrowBalanceTimeout(
    @Param('transferId') transferId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const processing = await retailerEscrowTransferService.handleBalanceTimeout(
        transferId,
        req.body as Record<string, unknown>,
      );
      return res.status(200).json({
        Result: { ResultCode: 0, ResultDesc: 'Escrow balance timeout received' },
        processing,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_BALANCE][TIMEOUT]', { transferId, error: reason });
      return res.status(200).json({
        Result: { ResultCode: 0, ResultDesc: 'Escrow balance timeout received' },
        accepted: false,
        reason,
      });
    }
  }

  @Post('callbacks/mpesa/escrow-transfer/:transferId')
  @ApiOperation({
    summary: 'Receive a retailer escrow B2B transfer result',
    description: 'Updates the retailer expected remaining float only after Safaricom confirms the transfer, then resumes settlement splitting.',
  })
  @ApiResponse({ status: 200, description: 'Escrow B2B callback received and acknowledged' })
  async receiveEscrowTransferCallback(
    @Param('transferId') transferId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const processing = await retailerEscrowTransferService.handleTransferCallback(
        transferId,
        req.body as Record<string, unknown>,
      );
      let settlement;
      if (processing.status === 'SUCCEEDED' && typeof processing.merchantTransactionReference === 'string') {
        settlement = await this.settlementService.splitAndAllocateFunds({
          merchantTransactionReference: processing.merchantTransactionReference,
          provider: 'MPESA_ESCROW_B2B',
          resultCode: 0,
          resultDesc: 'Retailer escrow transfer confirmed',
        });
      }
      return res.status(200).json({
        Result: { ResultCode: 0, ResultDesc: 'Escrow transfer callback received' },
        processing,
        settlement,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_TRANSFER][CALLBACK]', { transferId, error: reason });
      return res.status(200).json({
        Result: { ResultCode: 0, ResultDesc: 'Escrow transfer callback received' },
        accepted: false,
        reason,
      });
    }
  }

  @Post('callbacks/mpesa/escrow-transfer-timeout/:transferId')
  @ApiOperation({
    summary: 'Receive a retailer escrow B2B timeout',
    description: 'Keeps the transfer pending and float locked until Safaricom confirms the final result, preventing a duplicate transfer.',
  })
  @ApiResponse({ status: 200, description: 'Transfer timeout callback acknowledged for outcome reconciliation' })
  async receiveEscrowTransferTimeout(
    @Param('transferId') transferId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const processing = await retailerEscrowTransferService.handleTransferTimeout(
        transferId,
        req.body as Record<string, unknown>,
      );
      return res.status(200).json({
        Result: { ResultCode: 0, ResultDesc: 'Escrow transfer timeout received' },
        processing,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_TRANSFER][TIMEOUT]', { transferId, error: reason });
      return res.status(200).json({
        Result: { ResultCode: 0, ResultDesc: 'Escrow transfer timeout received' },
        accepted: false,
        reason,
      });
    }
  }

  @Post('callbacks/mpesa/:callbackIdentifier')
  @ApiOperation({ summary: 'Receive and parse an MPesa callback with a callback identifier and trigger settlement split' })
  async receiveCallbackWithIdentifier(
    @Param('callbackIdentifier') callbackIdentifier: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const timestamp = new Date().toISOString();
    try {
      this.logger.log('[PAYMENT][CALLBACK][RAW]', JSON.stringify({
        timestamp,
        path: req.originalUrl,
        callbackIdentifier,
        body: req.body,
      }));

      const payoutCallback = this.toPayoutCallback(req.body as Record<string, unknown>);
      if (payoutCallback) {
        const payoutResult = await this.settlementService.handleB2bPayoutCallback(payoutCallback, callbackIdentifier);
        return res.status(200).json({ received: true, accepted: true, timestamp, payout: payoutResult });
      }

      // Step 1: Parse the M-Pesa callback
      const parsed = parseStkCallback(req.body as Record<string, unknown>);
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
        return res.status(200).json({
          received: true,
          accepted: false,
          timestamp,
          reason: 'Transaction not found in database',
          parsed,
        });
      }

      // Step 3: If payment was successful, trigger settlement split
      if (parsed.status === 'completed') {
        const gatewayPayload = (req.body as any)?.Body?.gatewayPayload;
        const merchantTransactionReference =
          gatewayPayload?.merchantTransactionReference ??
          resolvedMerchantTransactionReference ??
          null;

        if (merchantTransactionReference) {
          try {
            // Call settlement split endpoint which will handle all splitting and payout logic
            const splitResult = await this.settlementService.splitAndAllocateFunds({
              merchantTransactionReference,
              mpesaReceipt: parsed.receipt ?? undefined,
              mpesaCheckoutRequestId: parsed.checkoutRequestId ?? undefined,
              mpesaMerchantRequestId: parsed.merchantRequestId ?? undefined,
              resultCode: parsed.resultCode ?? undefined,
              resultDesc: parsed.resultDesc ?? undefined,
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

  private toPayoutCallback(payload: Record<string, unknown>): Record<string, any> | null {
    const result = payload?.Result as Record<string, any> | undefined;
    if (!result || !result.OriginatorConversationID) {
      return null;
    }

    const resultCode = Number(result.ResultCode ?? -1);
    const resultParameters = result.ResultParameters?.ResultParameter;
    const parameters = Array.isArray(resultParameters)
      ? resultParameters
      : resultParameters && typeof resultParameters === 'object'
        ? [resultParameters]
        : [];
    const parameterValue = (key: string) => {
      const parameter = parameters.find((item: any) => item?.Key === key);
      return parameter?.Value ?? null;
    };

    return {
      reference: String(result.OriginatorConversationID),
      transactionId: result.TransactionID ?? null,
      providerReference: result.TransactionID ?? null,
      merchantTransactionReference: String(result.OriginatorConversationID),
      status: resultCode === 0 ? 'SUCCESS' : 'FAILED',
      amount: parameterValue('TransactionAmount'),
      resultCode,
      resultDescription: result.ResultDesc ?? null,
      metadata: {
        rawResult: result,
        conversationId: result.ConversationID ?? null,
        resultType: result.ResultType ?? null,
      },
    };
  }
}
