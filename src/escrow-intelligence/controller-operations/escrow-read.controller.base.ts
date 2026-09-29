import { Body, Get, Param, Post, Query } from '@nestjs/common';
import { EscrowControllerContextBase } from './controller-context.base';

export abstract class EscrowReadControllerBase extends EscrowControllerContextBase {
  @Get('health')
  health() {
    return { ok: true, service: 'escrow-intelligence' };
  }

  @Post('reconcile')
  async reconcile(@Body() body: { customerId: string; date?: string }) {
    return this.escrowIntelligenceService.reconcileEscrow(body.customerId, body.date ? new Date(body.date) : new Date());
  }

  @Get('summary/:customerId')
  async summary(@Param('customerId') customerId: string, @Query('date') date?: string) {
    return this.escrowIntelligenceService.getDailyCustomerSummary(customerId, date ? new Date(date) : new Date());
  }
}
