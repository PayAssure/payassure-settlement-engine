import { Post, Param, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { retailerEscrowReconciliationService, retailerEscrowTransferService, retailerFloatDepositService } from '../../../retailer';
import { EscrowTransferCallbacksBase } from './escrow-transfer-callbacks.base';

export abstract class EscrowBalanceCallbacksBase extends EscrowTransferCallbacksBase {
  @Post('callbacks/mpesa/retailer-escrow-balance')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive the general retailer escrow account balance result' })
  @ApiResponse({ status: 200, description: 'Retailer escrow account balance result received and acknowledged' })
  async receiveRetailerEscrowBalanceCallback(@Req() req: Request, @Res() res: Response) {
    const timestamp = new Date().toISOString();
    this.logger.log('[PAYMENT][RETAILER_ESCROW_BALANCE][CALLBACK]', JSON.stringify({ timestamp, body: req.body }));
    return res.status(200).json({ Result: { ResultCode: '0', ResultDesc: 'Retailer escrow account balance result received' } });
  }

  @Post('callbacks/mpesa/retailer-escrow-balance-timeout')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive the general retailer escrow account balance timeout' })
  @ApiResponse({ status: 200, description: 'Retailer escrow account balance timeout received and acknowledged' })
  async receiveRetailerEscrowBalanceTimeout(@Req() req: Request, @Res() res: Response) {
    const timestamp = new Date().toISOString();
    this.logger.warn('[PAYMENT][RETAILER_ESCROW_BALANCE][TIMEOUT]', JSON.stringify({ timestamp, body: req.body }));
    return res.status(200).json({ Result: { ResultCode: '0', ResultDesc: 'Retailer escrow account balance timeout received' } });
  }

  @Post('callbacks/mpesa/retailer-float-deposit/:depositId')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a retailer float deposit STK callback', description: 'Updates the retailer expected float only after a successful callback. Replayed callbacks are acknowledged without a second balance update.' })
  @ApiResponse({ status: 200, description: 'Retailer float deposit callback received and acknowledged' })
  async receiveRetailerFloatDepositCallback(
    @Param('depositId') depositId: string,
    @Query('token') callbackToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const processing = await retailerFloatDepositService.handleCallback(depositId, req.body as Record<string, unknown>, callbackToken);
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

  @Post('callbacks/mpesa/escrow-reconciliation/:reconciliationId')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive the shared escrow account balance reconciliation result' })
  @ApiResponse({ status: 200, description: 'Reconciliation callback received and acknowledged' })
  async receiveEscrowReconciliationCallback(@Param('reconciliationId') reconciliationId: string, @Req() req: Request, @Res() res: Response) {
    try {
      const processing = await retailerEscrowReconciliationService.handleCallback(reconciliationId, req.body as Record<string, unknown>);
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow reconciliation callback received' }, processing });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_RECONCILIATION][CALLBACK]', { reconciliationId, error: reason });
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow reconciliation callback received' }, accepted: false, reason });
    }
  }

  @Post('callbacks/mpesa/escrow-reconciliation-timeout/:reconciliationId')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a shared escrow account balance reconciliation timeout' })
  @ApiResponse({ status: 200, description: 'Reconciliation timeout callback acknowledged' })
  async receiveEscrowReconciliationTimeout(@Param('reconciliationId') reconciliationId: string, @Req() req: Request, @Res() res: Response) {
    try {
      const processing = await retailerEscrowReconciliationService.handleTimeout(reconciliationId, req.body as Record<string, unknown>);
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow reconciliation timeout received' }, processing });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[PAYMENT][ESCROW_RECONCILIATION][TIMEOUT]', { reconciliationId, error: reason });
      return res.status(200).json({ Result: { ResultCode: 0, ResultDesc: 'Escrow reconciliation timeout received' }, accepted: false, reason });
    }
  }
}
