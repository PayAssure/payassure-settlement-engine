import { EquityBankSanitizationBase } from './sanitization.base';

export abstract class EquityBankDebugBase extends EquityBankSanitizationBase {
  protected debugLog(event: string, details: Record<string, unknown>): void {
    const debugMode = (process.env.EQUITY_BANK_DEBUG_LOGGING || '').toLowerCase();
    if (!debugMode) return;

    const payload = debugMode === 'redacted' || debugMode === 'masked' ? this.sanitizeForLogging(details) : details;
    this.logger.log(`[EQUITY_BANK][${event}] ${JSON.stringify(payload)}`);
  }
}
