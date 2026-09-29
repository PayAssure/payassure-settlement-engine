export interface B2bPayoutRecipient {
  type: string;
  provider?: string | null;
  shortcode?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  phoneNumber?: string | null;
  payerPhoneNumber?: string | null;
}

export interface B2bGatewayResponse {
  success: boolean;
  statusCode?: number;
  responseCode?: string;
  responseDescription?: string;
  response?: any;
  error?: string;
}
