export interface RetailerEscrowMpesaConfig {
  environment: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  partyA: string;
  initiatorName: string;
  initiatorPassword: string;
  callbackUrl: string;
}

export function getRetailerEscrowMpesaConfig(): RetailerEscrowMpesaConfig {
  const prefix = 'MPESA_RETAILER_';
  const readRequired = (name: string): string => {
    const value = process.env[`${prefix}${name}`]?.trim();
    if (!value) {
      throw new Error(`Missing required retailer M-Pesa configuration: ${prefix}${name}`);
    }
    return value;
  };

  const shortcode = readRequired('SHORTCODE');
  return {
    environment: readRequired('ENVIRONMENT'),
    consumerKey: readRequired('CONSUMER_KEY'),
    consumerSecret: readRequired('CONSUMER_SECRET'),
    shortcode,
    passkey: readRequired('PASSKEY'),
    partyA: process.env[`${prefix}PARTY_A`]?.trim() || shortcode,
    initiatorName: readRequired('INITIATOR_NAME'),
    initiatorPassword: readRequired('INITIATOR_PASSWORD'),
    callbackUrl: readRequired('CALLBACK_URL'),
  };
}

export function getRetailerEscrowMpesaLogContext(config: RetailerEscrowMpesaConfig): Record<string, unknown> {
  const partyAOverride = process.env.MPESA_RETAILER_PARTY_A?.trim();
  return {
    environment: { variable: 'MPESA_RETAILER_ENVIRONMENT', value: config.environment },
    consumerKey: {
      variable: 'MPESA_RETAILER_CONSUMER_KEY',
      configured: Boolean(config.consumerKey),
      value: config.consumerKey ? '[REDACTED]' : '[MISSING]',
    },
    consumerSecret: {
      variable: 'MPESA_RETAILER_CONSUMER_SECRET',
      configured: Boolean(config.consumerSecret),
      value: config.consumerSecret ? '[REDACTED]' : '[MISSING]',
    },
    shortcode: { variable: 'MPESA_RETAILER_SHORTCODE', value: config.shortcode },
    passkey: {
      variable: 'MPESA_RETAILER_PASSKEY',
      configured: Boolean(config.passkey),
      value: config.passkey ? '[REDACTED]' : '[MISSING]',
    },
    partyA: {
      variable: partyAOverride ? 'MPESA_RETAILER_PARTY_A' : 'MPESA_RETAILER_SHORTCODE (fallback)',
      value: config.partyA,
    },
    initiatorName: { variable: 'MPESA_RETAILER_INITIATOR_NAME', value: config.initiatorName },
    initiatorPassword: {
      variable: 'MPESA_RETAILER_INITIATOR_PASSWORD',
      configured: Boolean(config.initiatorPassword),
      value: config.initiatorPassword ? '[REDACTED]' : '[MISSING]',
    },
    callbackUrl: { variable: 'MPESA_RETAILER_CALLBACK_URL', value: config.callbackUrl },
  };
}