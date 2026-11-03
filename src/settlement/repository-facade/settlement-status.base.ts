import { SettlementListsBase } from './settlement-lists.base';
import type { SettlementWebhookEvent } from '../services/settlement-webhook-delivery.service';

export abstract class SettlementStatusBase extends SettlementListsBase {
  async updateSettlementStatus(id: string, status: any, updates?: Record<string, any>) {
    const settlement = await this.settlements.updateSettlementStatus(id, status, updates);
    const metadata = settlement.metadata && typeof settlement.metadata === 'object'
      ? settlement.metadata as Record<string, any>
      : {};

    if (status === 'PROCESSING' && (
      (Array.isArray(metadata.payoutDispatches) && metadata.payoutDispatches.length > 0)
      || (Array.isArray(metadata.payoutCallbacks) && metadata.payoutCallbacks.length > 0)
    )) {
      await this.notifyWebhookEvent(id, 'payment.settlement.progress');
    } else if (status === 'AWAITING_RECONCILIATION') {
      await this.notifyWebhookEvent(id, 'payment.settlement.reconciliation_required');
    } else if (status === 'COMPLETED') {
      await this.notifyWebhookEvent(id, 'payment.settlement.completed');
    }
    return settlement;
  }

  async updateSettlementReconciliation(id: string, bankReference: string, bankTransactionId?: string) {
    const settlement = await this.settlements.updateSettlementReconciliation(id, bankReference, bankTransactionId);
    await this.notifyWebhookEvent(id, 'payment.settlement.completed');
    return settlement;
  }

  async notifyWebhookEvent(
    settlementId: string,
    eventType: SettlementWebhookEvent,
    details: Record<string, unknown> = {},
  ) {
    await this.webhooks.notify(settlementId, eventType, details);
  }
}
