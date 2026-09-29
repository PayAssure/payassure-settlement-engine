import type { MpesaRequestCredentials } from './types';
import { MpesaAuthenticationBase } from './authentication.base';

export abstract class MpesaRequestBase extends MpesaAuthenticationBase {
  async makeRequest(
    endpoint: string,
    payload: Record<string, unknown>,
    credentials?: MpesaRequestCredentials,
  ): Promise<Record<string, unknown>> {
    const env = this.currentEnvironment();
    const environment = credentials?.environment ?? env.environment;
    const baseUrl = this.getBaseUrl(environment);
    const apiEndpoint = this.getEndpointPath(endpoint, environment);
    if (!apiEndpoint) throw new Error(`Unsupported M-Pesa endpoint: ${endpoint}`);
    const token = await this.getAccessToken(credentials);
    const url = `${baseUrl}${apiEndpoint}`;
    const loggedPayload = Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, ['SecurityCredential', 'Password'].includes(key) ? '[redacted]' : value]),
    );
    await this.logRequest({ endpoint, method: 'POST', path: apiEndpoint, requestBody: loggedPayload });
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.logger.error(`[PAYMENT][ERROR] endpoint=${endpoint} status=${response.status} statusText=${response.statusText}`, {
        httpStatus: response.status,
        statusText: response.statusText,
        errorResponse: data,
        url,
        environment: environment || 'not set (defaulting to sandbox)',
      });
      if (response.status === 403) {
        this.logger.error(`[PAYMENT][403_FORBIDDEN] ${endpoint}`, {
          possibleCauses: [
            'Invalid or expired SecurityCredential',
            'Initiator not authorized for this transaction type',
            'IP address not whitelisted on M-Pesa account',
            'MPESA_ENVIRONMENT mismatch (sandbox creds on production or vice versa)',
            'ConsumerKey/ConsumerSecret invalid for environment',
          ],
          debugInfo: {
            consumerKeyLength: credentials?.consumerKey?.length || env.consumerKey?.length || 0,
            consumerSecretLength: credentials?.consumerSecret?.length || env.consumerSecret?.length || 0,
            securityCredentialLength: (payload.SecurityCredential as string)?.length || 0,
          },
          timestamp: new Date().toISOString(),
        });
      }
      throw new Error(`M-Pesa ${endpoint} request failed: ${response.status} ${response.statusText} ${message}`);
    }
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  }
}
