import { Post, Param, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { retailerEscrowTransferService } from '../../../retailer';
import { IdentifierCallbackBase } from './identifier-callback.base';

export abstract class EscrowTransferCallbacksBase extends IdentifierCallbackBase {
  @Post('callbacks/mpesa/escrow-transfer/:transferId')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a retailer escrow B2B transfer result', description: 'Updates the retailer expected remaining float only after Safaricom confirms the transfer, then resumes settlement splitting.' })
  @ApiResponse({ status: 200, description: 'Escrow B2B callback received and acknowledged' })
  async receiveEscrowTransferCallback(@Param('transferId') transferId: string, @Req() req: Request, @Res() res: Response) {
    try {
      const processing = await retailerEscrowTransferService.handleTransferCallback(transferId, req.body as Record<string, unknown>);
      let settlement;
      if (processing.status === 'SUCCEEDED' && typeof processing.merchantTransactionReference === 'string') {
        settlement = await this.settlementService.splitAndAllocateFunds({
          merchantTransactionReference: processing.merchantTransactionReference,
          provider: 'MPESA_ESCROW_B2B',
          resultCode: 0,
          resultDesc: 'Retailer escrow transfer confirmed',
        });
      }
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow transfer callback received' }, processing, settlement });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_TRANSFER][CALLBACK]', { transferId, error: reason });
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow transfer callback received' }, accepted: false, reason });
    }
  }

  @Post('callbacks/mpesa/escrow-transfer-timeout/:transferId')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a retailer escrow B2B timeout', description: 'Keeps the transfer pending and float locked until Safaricom confirms the final result, preventing a duplicate transfer.' })
  @ApiResponse({ status: 200, description: 'Transfer timeout callback acknowledged for outcome reconciliation' })
  async receiveEscrowTransferTimeout(@Param('transferId') transferId: string, @Req() req: Request, @Res() res: Response) {
    try {
      const processing = await retailerEscrowTransferService.handleTransferTimeout(transferId, req.body as Record<string, unknown>);
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow transfer timeout received' }, processing });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_TRANSFER][TIMEOUT]', { transferId, error: reason });
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow transfer timeout received' }, accepted: false, reason });
    }
  }
}
