import { MockProviderQueriesBase } from './mock-provider-queries.base';

export abstract class MockProviderControlsBase extends MockProviderQueriesBase {
  setFailureMode(mode: 'none' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal'): void {
    this.failureMode = mode;
  }

  getAuditLogs(): Array<Record<string, any>> {
    return [...this.auditLogs];
  }

  getProviderName(): string {
    return 'MockBankEscrowProvider';
  }
}
