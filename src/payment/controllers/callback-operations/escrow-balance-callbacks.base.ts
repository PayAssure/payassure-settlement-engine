import { Post, Param, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { retailerEscrowTransferService, retailerFloatDepositService } from '../../../retailer';
import { EscrowTransferCallbacksBase } from './escrow-transfer-callbacks.base';

export abstract class EscrowBalanceCallbacksBase extends EscrowTransferCallbacksBase {
  @Post('callbacks/mpesa/retailer-float-deposit/:depositId')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a retailer float deposit STK callback', description: 'Updates the retailer expected float only after a successful callback. Replayed callbacks are acknowledged without a second balance update.' })
  @ApiResponse({ status: 200, description: 'Retailer float deposit callback received and acknowledged' })
  async receiveRetailerFloatDepositCallback(@Param('depositId') depositId: string, @Req() req: Request, @Res() res: Response) {
    try {
      const processing = await retailerFloatDepositService.handleCallback(depositId, req.body as Record<string, unknown>);
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Retailer float deposit callback received' }, processing });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][RETAILER_FLOAT_DEPOSIT][CALLBACK]', { depositId, error: reason });
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Retailer float deposit callback received' }, accepted: false, reason });
    }
  }

  @Post('callbacks/mpesa/escrow-balance/:transferId')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a retailer escrow balance result', description: 'Validates the retailer account balance against its stored expected remainder. A valid result starts the CASH transfer flow.' })
  @ApiResponse({ status: 200, description: 'Escrow balance callback received and acknowledged' })
  async receiveEscrowBalanceCallback(@Param('transferId') transferId: string, @Req() req: Request, @Res() res: Response) {
    try {
      const processing = await retailerEscrowTransferService.handleBalanceCallback(transferId, req.body as Record<string, unknown>);
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow balance callback received' }, processing });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_BALANCE][CALLBACK]', { transferId, error: reason });
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow balance callback received' }, accepted: false, reason });
    }
  }

  @Post('callbacks/mpesa/escrow-balance-timeout/:transferId')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a retailer escrow balance query timeout' })
  @ApiResponse({ status: 200, description: 'Balance timeout callback acknowledged; the pending check is failed safely' })
  async receiveEscrowBalanceTimeout(@Param('transferId') transferId: string, @Req() req: Request, @Res() res: Response) {
    try {
      const processing = await retailerEscrowTransferService.handleBalanceTimeout(transferId, req.body as Record<string, unknown>);
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow balance timeout received' }, processing });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_BALANCE][TIMEOUT]', { transferId, error: reason });
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow balance timeout received' }, accepted: false, reason });
    }
  }
}
