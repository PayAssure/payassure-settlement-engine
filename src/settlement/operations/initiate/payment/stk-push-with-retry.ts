import { mpesaService } from '../../../../payment/services/mpesa.service';

const GATEWAY_REQUEST_TIMEOUT_MS = 15000;

export async function sendStkPushRequest(payload: Record<string, any>) {
  return mpesaService.initiateStkPush(payload);
}

function shouldRetryGatewayError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const statusMatch = normalized.match(/gateway returned (\d{3})/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : undefined;

  if (normalized.includes(`gateway request timed out after ${GATEWAY_REQUEST_TIMEOUT_MS}ms`)) return false;
  if (statusCode !== undefined) return [408, 429, 500, 502, 503, 504].includes(statusCode);

  return [
    'econnreset', 'econnrefused', 'etimedout', 'enetunreach', 'socket hang up',
    'aggregateerror', 'fetch failed', 'timed out', 'getaddrinfo', 'network',
  ].some((token) => normalized.includes(token));
}

export async function sendStkPushRequestWithRetry(
  sender: (payload: Record<string, any>) => Promise<any>,
  logger: Pick<any, 'log' | 'warn' | 'error'>,
  merchantTransactionReference: string,
  maxAttempts = 3,
  baseDelayMs = 1000,
) {
  let lastError: Error | undefined;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsMade = attempt;
    try {
      const response = await sender({});
      return { success: true, response };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const shouldRetry = shouldRetryGatewayError(lastError) && attempt < maxAttempts;
      logger.warn?.(`Gateway attempt ${attempt}/${maxAttempts} failed for merchantTransactionReference=${merchantTransactionReference}: ${lastError.message}`);
      if (!shouldRetry) break;

      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 4000);
      if (delayMs > 0) {
        logger.warn?.(`Waiting ${delayMs}ms before retry ${attempt + 1}/${maxAttempts} for merchantTransactionReference=${merchantTransactionReference}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const retryable = lastError ? shouldRetryGatewayError(lastError) : false;
  logger.error?.(`Gateway delivery failed after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'} for merchantTransactionReference=${merchantTransactionReference}`);
  return {
    success: false,
    message: `Gateway delivery failed after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'}`,
    error: lastError?.message ?? 'Unknown gateway error',
    retryable,
    attempts: attemptsMade,
  };
}