export interface MpesaEnv {
  MPESA_ENVIRONMENT?: string;
  MPESA_CONSUMER_KEY?: string;
  MPESA_CONSUMER_SECRET?: string;
  MPESA_SHORTCODE?: string;
  MPESA_PARTYA?: string;
  MPESA_PASSKEY?: string;
  MPESA_INITIATOR_NAME?: string;
  MPESA_INITIATOR_PASSWORD?: string;
  MPESA_CALLBACK_URL?: string;
}

export interface B2BRequest {
  recipientShortCode: string;
  recieverPartyPublicID?: string;
  amount: number;
  description?: string;
  accountReference?: string;
  callbackUrl?: string;
}
