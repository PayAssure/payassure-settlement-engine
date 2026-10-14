import type { MpesaRequestCredentials } from './types';
import { MpesaAuthenticationBase } from './authentication.base';
import { sanitizeMpesaRequestPayload, sanitizeMpesaResponsePayload } from './request-logging';

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
    const url = `${baseUrl}${apiEndpoint}`;
    const loggedPayload = sanitizeMpesaRequestPayload(payload);
    await this.logRequest({ endpoint, method: 'POST', path: apiEndpoint, requestBody: loggedPayload });
    console.log(`[PAYMENT][REQUEST] ${JSON.stringify({
      endpoint,
      method: 'POST',
      url,
      environment: environment || 'not set (defaulting to sandbox)',
      payload: loggedPayload,
    })}`);
    const token = await this.getAccessToken(credentials, endpoint, loggedPayload);
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let data: unknown;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = responseText || '(empty response body)';
    }
    const safeResponse = sanitizeMpesaResponsePayload(data);
    if (!response.ok) {
      const message = typeof safeResponse === 'string' ? safeResponse : JSON.stringify(safeResponse);
      this.logger.error(`[PAYMENT][ERROR] endpoint=${endpoint} status=${response.status} statusText=${response.statusText}`, {
        httpStatus: response.status,
        statusText: response.statusText,
        errorResponse: safeResponse,
        url,
        environment: environment || 'not set (defaulting to sandbox)',
        requestPayload: loggedPayload,
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
    console.log(`[PAYMENT][RESPONSE] ${JSON.stringify({
      endpoint,
      httpStatus: response.status,
      statusText: response.statusText,
      response: safeResponse,
    })}`);
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : {};
  }
}
