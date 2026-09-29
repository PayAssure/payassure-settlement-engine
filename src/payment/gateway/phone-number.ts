export function formatPhoneNumber(input: string): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) return input;
  if (digits.startsWith('0')) {
    return `254${digits.slice(1)}`;
  }
  if (digits.startsWith('+254')) {
    return digits.replace('+', '');
  }
  return digits;
}
