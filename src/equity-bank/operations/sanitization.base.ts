import { EquityBankSecretsBase } from './secrets.base';

export abstract class EquityBankSanitizationBase extends EquityBankSecretsBase {
  protected sanitizeForLogging(value: unknown): unknown {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return this.sanitizeForLogging(JSON.parse(trimmed));
        } catch {
          return value;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeForLogging(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          const normalizedKey = key.toLowerCase();
          const shouldRedact = /(?:secret|token|signature|authorization|password|passphrase|private[_-]?key|merchant[_-]?code|consumer[_-]?secret|api[_-]?key)/.test(normalizedKey);
          return [key, shouldRedact ? this.maskSecret(this.stringifyForLogging(child)) : this.sanitizeForLogging(child)];
        }),
      );
    }
    return value;
  }

  protected sanitizeAuthResponse(body: Record<string, unknown>): Record<string, unknown> {
    return {
      ...body,
      accessToken: typeof body.accessToken === 'string' ? this.maskSecret(body.accessToken) : body.accessToken,
      refreshToken: typeof body.refreshToken === 'string' ? this.maskSecret(body.refreshToken) : body.refreshToken,
    };
  }
}
