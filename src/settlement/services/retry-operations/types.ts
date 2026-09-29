export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface RetrySchedule {
  attempt: number;
  delayMs: number;
  nextRetryAt: Date;
}
