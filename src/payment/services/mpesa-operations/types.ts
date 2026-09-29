export interface MpesaRequestCredentials {
  environment?: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface PaymentRequestLog {
  endpoint: string;
  method: string;
  path: string;
  requestBody: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
}
