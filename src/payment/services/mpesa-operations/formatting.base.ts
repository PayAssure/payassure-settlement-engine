import { MpesaServiceContextBase } from './context.base';

export abstract class MpesaFormattingBase extends MpesaServiceContextBase {
  generateTimestamp(): string {
    return new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  }

  buildPassword(shortcode: string, passkey: string, timestamp: string): string {
    return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  }

  formatPhoneNumber(phoneNumber: string): string {
    const digits = String(phoneNumber ?? '').replace(/\D/g, '');
    if (!digits) return phoneNumber;
    if (digits.startsWith('0')) return `254${digits.slice(1)}`;
    if (digits.startsWith('+254')) return digits.replace('+', '');
    return digits;
  }
}
