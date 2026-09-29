import { createHash } from 'crypto';
import type { Logger } from '@nestjs/common';

export abstract class EquityBankSecretsBase {
  protected abstract readonly logger: Logger;

  protected stringifyForLogging(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  protected maskSecret(value: string | undefined): string {
    if (!value) return '[not-set]';
    return `[redacted fingerprint=${this.fingerprint(value)}]`;
  }

  protected fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }
}
