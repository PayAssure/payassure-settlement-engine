import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { retailerEscrowReconciliationService } from './retailer-escrow-reconciliation.service';

const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;

export class RetailerEscrowReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetailerEscrowReconciliationScheduler.name);
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  onModuleInit() {
    this.interval = setInterval(() => {
      void this.runReconciliation();
    }, RECONCILIATION_INTERVAL_MS);
    this.interval.unref();
    this.logger.log('[ESCROW_RECONCILIATION][SCHEDULER_STARTED]', { intervalMs: RECONCILIATION_INTERVAL_MS });
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private async runReconciliation() {
    if (this.running) return;
    this.running = true;
    try {
      await retailerEscrowReconciliationService.requestReconciliation();
    } catch (error) {
      this.logger.error('[ESCROW_RECONCILIATION][SCHEDULER_FAILED]', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
    }
  }
}