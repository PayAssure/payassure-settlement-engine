import { EscrowReconciliationBase } from './reconciliation.base';
import type { EscrowProviderType, EscrowReconciliationResult, EscrowTransactionRecord, MockEscrowScenario } from '../escrow-intelligence.types';

export abstract class EscrowCollectionSimulationBase extends EscrowReconciliationBase {
  async simulateSettlementCollection(payload: {
    customerId: string;
    amount: number;
    provider: EscrowProviderType;
    scenario?: MockEscrowScenario;
    supplierAmount?: number;
    platformFee?: number;
    retailerEscrowBalance?: number;
    expectedTransactions?: EscrowTransactionRecord[];
  }): Promise<any> {
    const provider = String(payload.provider ?? 'MPESA').toUpperCase() as EscrowProviderType;
    const transactionList = payload.expectedTransactions ?? this.getExpectedTransactions(payload.customerId);
    const expectedBalance = this.calculateExpectedBalance(payload.customerId, undefined, transactionList);
    const actualBalance = Number(payload.retailerEscrowBalance ?? (await this.bankProvider.getCustomerEscrowBalance(payload.customerId)).balance ?? 0);
    const collection = await this.bankProvider.simulateCollection?.({
      customerId: payload.customerId,
      amount: Number(payload.amount ?? 0),
      provider,
      scenario: payload.scenario ?? 'success',
      supplierAmount: Number(payload.supplierAmount ?? payload.amount ?? 0),
      platformFee: Number(payload.platformFee ?? 0),
      retailerEscrowBalance: actualBalance,
    }) ?? {
      status: 'SUCCESS',
      provider,
      scenario: payload.scenario ?? 'success',
      expectedBalance,
      actualBalance,
      collectedAmount: Number(payload.amount ?? 0),
      message: 'Collection simulation successful',
    };

    const blocked = collection.status !== 'SUCCESS';
    return {
      provider,
      expectedBalance,
      actualBalance,
      collection,
      settlementStatus: blocked ? 'BLOCKED' : 'READY',
      auditLogs: this.bankProvider.getAuditLogs?.() ?? [],
      message: blocked ? 'Settlement blocked due to payment provider or escrow validation failure.' : 'Settlement collection validated and settlement can proceed.',
    };
  }

  getReconciliationHistory(): EscrowReconciliationResult[] {
    return [...this.reconciliationHistory];
  }
}
