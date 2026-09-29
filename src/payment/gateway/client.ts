import type { SharedMpesaEnv } from './environment';

function getBaseUrl(environment?: string): string {
  return environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

async function getAccessToken(env: SharedMpesaEnv): Promise<string> {
  const auth = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await fetch(`${getBaseUrl(env.MPESA_ENVIRONMENT)}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));
  const token = typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).access_token === 'string'
    ? (data as Record<string, unknown>).access_token as string
    : undefined;

  if (!response.ok || !token) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`M-Pesa authentication failed: ${message}`);
  }

  return token;
}

export async function makeMpesaRequest(env: SharedMpesaEnv, endpoint: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const baseUrl = getBaseUrl(env.MPESA_ENVIRONMENT);
  const endpointMap: Record<string, string> = {
    stk_push: '/mpesa/stkpush/v1/processrequest',
    stk_query: '/mpesa/stkpushquery/v1/query',
    b2c: '/mpesa/b2c/v1/paymentrequest',
    b2b: '/mpesa/b2b/v1/paymentrequest',
    b2pochi: '/mpesa/b2pochi/v1/paymentrequest',
    c2b_register: '/mpesa/c2b/v1/registerurl',
    c2b_simulate: '/mpesa/c2b/v1/simulate',
    reversal: '/mpesa/reversal/v1/request',
  };

  const apiEndpoint = endpointMap[endpoint];
  if (!apiEndpoint) {
    throw new Error(`Unsupported M-Pesa endpoint: ${endpoint}`);
  }

  if (!env.MPESA_CONSUMER_KEY || !env.MPESA_CONSUMER_SECRET || !env.MPESA_SHORTCODE || !env.MPESA_PASSKEY) {
    throw new Error(`M-Pesa ${endpoint} request cannot be sent without full credentials`);
  }

  const token = await getAccessToken(env);
  const response = await fetch(`${baseUrl}${apiEndpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`M-Pesa ${endpoint} request failed: ${response.status} ${response.statusText} ${message}`);
  }

  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}
