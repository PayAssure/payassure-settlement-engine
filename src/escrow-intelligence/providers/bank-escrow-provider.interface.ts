import {
  BankEscrowBalanceSnapshot,
  EscrowProviderType,
  EscrowTransactionRecord,
  MockEscrowScenario,
} from '../escrow-intelligence.types';

export interface MockCollectionResult {
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  provider: EscrowProviderType;
  scenario: MockEscrowScenario;
  expectedBalance: number;
  actualBalance: number;
  collectedAmount: number;
  message: string;
  auditLogId?: string;
}

export interface BankEscrowProvider {
  getCustomerEscrowBalance(customerId: string, asOfDate?: Date): Promise<BankEscrowBalanceSnapshot>;
  getCustomerEscrowTransactions(customerId: string, asOfDate?: Date): Promise<EscrowTransactionRecord[]>;
  getProviderName(): string;
  setFailureMode?(mode: 'none' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal'): void;
  simulateCollection?(payload: {
    customerId: string;
    amount: number;
    provider: EscrowProviderType;
    scenario?: MockEscrowScenario;
    supplierAmount?: number;
    platformFee?: number;
    retailerEscrowBalance?: number;
  }): Promise<MockCollectionResult>;
  refundCollection?(payload: {
    customerId: string;
    amount: number;
    provider: EscrowProviderType;
    scenario?: MockEscrowScenario;
    description?: string;
  }): Promise<MockCollectionResult>;
  getAuditLogs?(): Array<Record<string, any>>;
}
