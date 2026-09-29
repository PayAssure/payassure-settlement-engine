import { MockProviderControlsBase } from './mock-provider-controls.base';
import type { EscrowProviderType, MockEscrowScenario } from '../../escrow-intelligence.types';
import type { MockCollectionResult } from '../bank-escrow-provider.interface';

export abstract class MockProviderCollectionBase extends MockProviderControlsBase {
  async simulateCollection(payload: {
    customerId: string;
    amount: number;
    provider: EscrowProviderType;
    scenario?: MockEscrowScenario;
    supplierAmount?: number;
    platformFee?: number;
    retailerEscrowBalance?: number;
  }): Promise<MockCollectionResult> {
    const scenario = payload.scenario ?? 'success';
    const provider = payload.provider ?? 'MPESA';
    const recipientAmount = Number(payload.supplierAmount ?? payload.amount ?? 0);
    const retainedFee = Number(payload.platformFee ?? 0);
    const expectedBalance = Number(payload.retailerEscrowBalance ?? 0);
    const actualBalance = provider === 'CASH' ? expectedBalance : Math.max(0, expectedBalance - recipientAmount - retainedFee);

    const logEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      customerId: payload.customerId,
      provider,
      scenario,
      amount: Number(payload.amount ?? 0),
      expectedBalance,
      actualBalance,
      supplierAmount: recipientAmount,
      retainedFee,
      status: 'RECORDED',
      createdAt: new Date().toISOString(),
    };

    this.auditLogs.push(logEntry);

    if (this.failureMode === 'provider-down' || scenario === 'provider-down') {
      return { status: 'FAILED', provider, scenario, expectedBalance, actualBalance, collectedAmount: 0, message: `Mock ${provider} provider is down. Settlement blocked.`, auditLogId: logEntry.id };
    }
    if (this.failureMode === 'duplicate' || scenario === 'duplicate') {
      return { status: 'BLOCKED', provider, scenario, expectedBalance, actualBalance, collectedAmount: 0, message: 'Duplicate transaction detected; settlement requires a new unique reference.', auditLogId: logEntry.id };
    }
    if (this.failureMode === 'reversal' || scenario === 'reversal') {
      return { status: 'BLOCKED', provider, scenario, expectedBalance, actualBalance, collectedAmount: 0, message: 'Mock reversal detected; all funds remain in escrow pending review.', auditLogId: logEntry.id };
    }
    if (this.failureMode === 'mismatch' || scenario === 'mismatch') {
      return { status: 'BLOCKED', provider, scenario, expectedBalance, actualBalance: Math.max(0, actualBalance - 100), collectedAmount: 0, message: 'Escrow balance mismatch: expected balance does not match actual bank balance.', auditLogId: logEntry.id };
    }

    if (provider === 'CASH' || scenario === 'cash-collection') {
      const currentBalance = await this.getCustomerEscrowBalance(payload.customerId);
      const requiredAmount = Number(payload.amount ?? 0);
      if (Number(currentBalance.balance ?? 0) < requiredAmount) {
        return {
          status: 'BLOCKED',
          provider,
          scenario,
          expectedBalance: Number(currentBalance.balance ?? 0),
          actualBalance: Number(currentBalance.balance ?? 0),
          collectedAmount: 0,
          message: `Insufficient retailer escrow balance. Available: ${Number(currentBalance.balance ?? 0)} KES. Required: ${requiredAmount} KES. Deposit funds into the escrow account before retrying the settlement.`,
          auditLogId: logEntry.id,
        };
      }

      const persisted = await this.persistCollectionToDatabase({
        customerId: payload.customerId,
        amount: Number(payload.amount ?? 0),
        provider,
        scenario,
        description: 'Cash collection from retailer escrow for supplier payout',
      });
      if (persisted) return persisted;
    }

    return { status: 'SUCCESS', provider, scenario, expectedBalance, actualBalance, collectedAmount: Number(payload.amount ?? 0), message: `Mock ${provider} collection succeeded and settlement can proceed.`, auditLogId: logEntry.id };
  }
}
