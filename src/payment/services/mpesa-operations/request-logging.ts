const SENSITIVE_REQUEST_FIELDS = new Set([
  'password',
  'securitycredential',
  'consumerkey',
  'consumersecret',
  'clientsecret',
  'accesstoken',
  'refreshtoken',
  'callbacktoken',
]);

function sanitizeValue(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
  if (SENSITIVE_REQUEST_FIELDS.has(normalizedKey)) return '[REDACTED]';

  if (typeof value === 'string') {
    return value.replace(/([?&]token=)[^&#]*/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue('', item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childKey, childValue),
      ]),
    );
  }
  return value;
}

export function sanitizeMpesaRequestPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue('', payload) as Record<string, unknown>;
}

export function sanitizeMpesaResponsePayload(payload: unknown): unknown {
  return sanitizeValue('', payload);
}
