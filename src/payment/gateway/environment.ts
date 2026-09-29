export interface SharedMpesaEnv {
  MPESA_ENVIRONMENT?: string;
  MPESA_CONSUMER_KEY?: string;
  MPESA_CONSUMER_SECRET?: string;
  MPESA_SHORTCODE?: string;
  MPESA_PARTYA?: string;
  MPESA_PASSKEY?: string;
  MPESA_INITIATOR_NAME?: string;
  MPESA_INITIATOR_PASSWORD?: string;
  MPESA_CALLBACK_URL?: string;
  PORT?: string;
}

export function getSharedMpesaEnv(): SharedMpesaEnv {
  return {
    MPESA_ENVIRONMENT: process.env.MPESA_ENVIRONMENT,
    MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET,
    MPESA_SHORTCODE: process.env.MPESA_SHORTCODE,
    MPESA_PARTYA: process.env.MPESA_PARTYA,
    MPESA_PASSKEY: process.env.MPESA_PASSKEY,
    MPESA_INITIATOR_NAME: process.env.MPESA_INITIATOR_NAME,
    MPESA_INITIATOR_PASSWORD: process.env.MPESA_INITIATOR_PASSWORD,
    MPESA_CALLBACK_URL: process.env.MPESA_CALLBACK_URL,
    PORT: process.env.PORT,
  };
}

export function generateTimestamp(): string {
  return new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
}

export function buildPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}
