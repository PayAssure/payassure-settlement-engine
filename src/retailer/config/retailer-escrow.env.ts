export interface RetailerEscrowMpesaConfig {
  environment: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
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
    partyA: process.env[`${prefix}PARTY_A`]?.trim() || shortcode,
    initiatorName: readRequired('INITIATOR_NAME'),
    initiatorPassword: readRequired('INITIATOR_PASSWORD'),
    callbackUrl: readRequired('CALLBACK_URL'),
  };
}