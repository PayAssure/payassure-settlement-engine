import { Post, Param, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { retailerEscrowTransferService } from '../../../retailer';
import { EscrowTransferCallbacksBase } from './escrow-transfer-callbacks.base';

export abstract class EscrowBalanceCallbacksBase extends EscrowTransferCallbacksBase {
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
