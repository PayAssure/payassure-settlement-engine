export type EscrowTransactionType = 'CREDIT' | 'DEBIT' | 'ADJUSTMENT' | 'FEE' | 'SETTLEMENT' | 'PAYOUT' | 'REFUND' | 'WITHDRAWAL' | 'DEPOSIT';
export type EscrowProviderType = 'MPESA' | 'CASH' | 'BANK';
export type MockEscrowScenario = 'success' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal' | 'cash-collection' | 'cash-refund';

export interface EscrowTransactionRecord {
  id: string;
  customerId: string;
  date: string;
  type: EscrowTransactionType | string;
  amount: number;
  description?: string;
  currency?: string;
}

export interface BankEscrowBalanceSnapshot {
  customerId: string;
  balance: number;
  currency?: string;
  asOf?: Date | string;
  source?: string;
}

export interface DailyEscrowSummary {
  customerId: string;
  date: string;
  expectedBalance: number;
  actualBalance: number;
  delta: number;
  netMovement: number;
  transactionCount: number;
  mismatch: boolean;
  alerts: string[];
  blocked: boolean;
  provider: string;
}

export interface EscrowReconciliationResult {
  customerId: string;
  date: string;
  status: 'MATCHED' | 'BLOCKED' | 'ERROR';
  expectedBalance: number;
  actualBalance: number;
  delta: number;
  transactionCount: number;
  blockedSettlement: boolean;
  alerts: string[];
  provider: string;
  reconciledAt: string;
}
