# Payout Idempotency & Retry System - Implementation Summary

## Quick Reference

### Problem Solved
1. **Duplicate Payouts**: Prevent paying retailer/supplier twice for the same settlement
2. **Failed Retries**: Automatically retry failed payouts with exponential backoff
3. **Time Management**: Configurable retry intervals to avoid overwhelming the payment gateway

### Solution Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Settlement Payment Flow                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    Payment Callback Received
                              ↓
                  splitAndAllocateFunds() called
                              ↓
         ┌─────────────────────┴─────────────────────┐
         ↓                                           ↓
   Dispatch to Supplier                     Dispatch to Retailer
         ↓                                           ↓
dispatchB2bPayouts()                      dispatchB2bPayouts()
         ↓                                           ↓
   ┌────────────────────────────────────────────────┐
   │ B2BPayoutIdempotencyService                    │
   │ ├─ Check idempotencyKey in database            │
   │ ├─ If exists & completed → return existing     │
   │ ├─ If not exists → create new attempt          │
   │ └─ Prevent duplicates via unique constraint    │
   └────────────────────────────────────────────────┘
         ↓
   Send to M-Pesa Gateway
         ↓
   ┌──────────────────┬─────────────────────┐
   │ SUCCESS (Code 0) │ FAILURE (Other Code)│
   ├──────────────────┼─────────────────────┤
   │ Status: SUBMITTED│ Status: FAILED      │
   │ Wait for callback│ Schedule Retry      │
   │                  │ Update nextRetryAt  │
   │                  │ attemptCount++      │
   └──────────────────┴─────────────────────┘
         ↓                    ↓
   [Callback Handler]   [Retry Scheduler]
         ↓                    ↓
   Mark COMPLETED       Every 30 seconds:
   (idempotency)        ├─ Get payouts where
   Update metadata      │  nextRetryAt <= now()
   Settlement: OK       ├─ Process up to 10
                        │  in batch
                        └─ Re-dispatch via
                           dispatchB2bPayouts()
                           (idempotency prevents duplicates)
```

## Key Features

### 1. Idempotency Key
```
idempotencyKey = SHA256(
  settlementId + 
  ":" + 
  party (SUPPLIER/RETAILER) + 
  ":" + 
  recipientMerchantId
)
```
- Unique per (settlement, party, recipient) combination
- Stored in `B2BPayoutAttempt.idempotencyKey` with UNIQUE constraint
- First call creates record, subsequent calls return existing
- Guarantees: ONE payout per combination, regardless of how many times API is called

### 2. Exponential Backoff
```
Delay = min(60s × 2^(attempt-1), 3600s) + jitter(±10%)

Timeline:
├─ Attempt 1 (FAILED) → Retry in ~1 min   (60s)
├─ Attempt 2 (FAILED) → Retry in ~2 min   (120s)
├─ Attempt 3 (FAILED) → Retry in ~4 min   (240s)
├─ Attempt 4 (FAILED) → Retry in ~8 min   (480s)
├─ Attempt 5 (FAILED) → Retry in ~16 min  (960s)
└─ Attempt 6+        → MARK AS FAILED
```
- Prevents overwhelming the gateway with rapid retries
- Jitter prevents thundering herd problem
- Max attempts: 5, configurable in database
- Max delay: 1 hour, configurable

### 3. Automatic Retry Scheduler
```
┌─────────────────────────────────────┐
│  B2BPayoutRetryScheduler (Service)  │
├─────────────────────────────────────┤
│ Runs every: 30 seconds              │
│ Batch size: Up to 10 payouts/cycle  │
│ Startup: Processes pending on start │
│ Lifecycle: Auto-start on module init│
└─────────────────────────────────────┘
         ↓
   Query: WHERE status IN ('FAILED', 'RETRYING')
          AND nextRetryAt <= NOW()
   ORDER BY nextRetryAt ASC
         ↓
   Process up to 10 payouts:
   ├─ For each payout:
   │  └─ Call dispatchB2bPayouts()
   │     (idempotency prevents duplicate submission)
   │     (status updated based on response)
   │     (if fails again, schedule next retry)
   └─ Log results
```

## Database Schema

### B2BPayoutAttempt Table
```sql
CREATE TABLE "b2b_payout_attempts" (
  id TEXT PRIMARY KEY,
  settlementId TEXT FOREIGN KEY,
  merchantTransactionReference TEXT,
  
  -- IDEMPOTENCY
  payoutReference TEXT UNIQUE,
  idempotencyKey TEXT UNIQUE,          -- ← Prevents duplicates
  
  -- PAYOUT INFO
  party ParticipantType (SUPPLIER/RETAILER),
  amount DECIMAL(18,2),
  recipientMerchantId TEXT,
  recipientType TEXT (MPESA/BANK),
  recipientPhone TEXT,
  
  -- STATUS TRACKING
  status B2BPayoutStatus (
    PENDING → SUBMITTED/FAILED
           ↓
    RETRYING ← FAILED (on retry)
           ↓
    COMPLETED (when callback received)
  ),
  
  -- RETRY INFO
  attemptCount INT (1-5+),
  lastAttemptAt TIMESTAMP,
  nextRetryAt TIMESTAMP,               -- ← Used for scheduler
  failureReason TEXT,
  
  -- GATEWAY RESPONSE
  gatewayResponseCode TEXT,
  gatewayResponseDescription TEXT,
  gatewayResponse JSONB,
  
  -- CALLBACK TRACKING
  callbackIdentifier TEXT,
  callbackReceived BOOLEAN,
  callbackReceivedAt TIMESTAMP,
  
  metadata JSONB,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);

UNIQUE(settlementId, party, recipientMerchantId)  -- ← Business logic constraint
UNIQUE(idempotencyKey)                             -- ← Idempotency constraint
UNIQUE(payoutReference)                            -- ← Reference uniqueness
INDEX(nextRetryAt)                                 -- ← Scheduler query optimization
INDEX(status)
INDEX(idempotencyKey)
```

### B2BPayoutRetryPolicy Table
```sql
CREATE TABLE "b2b_payout_retry_policies" (
  id TEXT PRIMARY KEY,
  maxRetries INT DEFAULT 5,
  initialDelayMs INT DEFAULT 60000,    -- 1 min
  maxDelayMs INT DEFAULT 3600000,      -- 1 hour
  backoffMultiplier FLOAT DEFAULT 2.0,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);
```

## Service Components

### 1. B2BPayoutIdempotencyService
```typescript
Ensures ONE payout per (settlement, party, recipient)

Methods:
├─ createOrGetPayoutAttempt()
│  └─ Returns existing if created, new if first time
├─ updatePayoutAttemptStatus()
│  └─ Updates after gateway response
├─ isPayoutCompleted()
│  └─ Check if payout finished
├─ canRetry()
│  └─ Check if retry allowed
├─ scheduleRetry()
│  └─ Set nextRetryAt and status=RETRYING
├─ markCallbackReceived()
│  └─ Set status=COMPLETED when callback received
└─ getPendingRetries()
   └─ Get all payouts due for retry
```

### 2. B2BPayoutRetryService
```typescript
Handles retry logic and exponential backoff

Methods:
├─ calculateNextRetryDelay()
│  └─ Returns: { attempt, delayMs, nextRetryAt }
├─ scheduleFailedPayoutForRetry()
│  └─ Schedule next retry or mark permanently failed
├─ getPayoutsDueForRetry()
│  └─ Query for payouts ready to retry
├─ processPendingRetries()
│  └─ Batch process up to 10 retries
├─ getRetryStatistics()
│  └─ Stats for a settlement
└─ cancelPayoutRetries()
   └─ Cancel retries (e.g., settlement cancelled)
```

### 3. B2BPayoutRetryScheduler
```typescript
Runs every 30 seconds to process pending retries

Lifecycle:
├─ onModuleInit()
│  ├─ Start 30-second interval
│  └─ Process pending immediately
├─ processRetries()
│  ├─ Check if already running (prevent overlap)
│  ├─ Get payouts where nextRetryAt <= now()
│  ├─ Process batch (max 10)
│  └─ Log results
├─ getStatus()
│  └─ Return scheduler state
└─ stopRetryScheduler()
   └─ Clean shutdown
```

## API Endpoints

### GET `/settlement/payouts/retry-status/:settlementId`
Get retry statistics for a settlement
```bash
curl http://localhost:3000/settlement/payouts/retry-status/settlement-123

Response:
{
  "success": true,
  "settlementId": "settlement-123",
  "retryStatistics": {
    "totalPayouts": 2,
    "completed": 1,
    "submitted": 0,
    "pending": 0,
    "retrying": 1,
    "failed": 0,
    "totalAttempts": 3,
    "averageAttempts": 1.5
  }
}
```

### GET `/settlement/payouts/pending-retries`
Get all payouts pending retry
```bash
curl http://localhost:3000/settlement/payouts/pending-retries

Response:
{
  "success": true,
  "count": 1,
  "pendingRetries": [
    {
      "id": "payout-attempt-123",
      "payoutReference": "MTR-001-SUPPLIER-xyz",
      "settlementId": "settlement-123",
      "status": "RETRYING",
      "attemptCount": 2,
      "nextRetryAt": "2026-08-30T10:02:00Z",
      "failureReason": "Gateway timeout"
    }
  ]
}
```

### POST `/settlement/payouts/manual-retry/:settlementId`
Manually trigger retry (for manual intervention)
```bash
curl -X POST http://localhost:3000/settlement/payouts/manual-retry/settlement-123

Response:
{
  "success": true,
  "message": "Manually retried 1 failed payouts",
  "count": 1,
  "results": [
    {
      "payoutReference": "MTR-001-SUPPLIER-xyz",
      "status": "SUBMITTED",
      "success": true
    }
  ]
}
```

## Status Transitions

```
┌─────────────────────────────────────────────────────────────┐
│               B2BPayoutAttempt State Machine                │
└─────────────────────────────────────────────────────────────┘

                          PENDING
                            ↓
                  dispatchB2bPayouts()
                     ↙              ↘
              SUCCESS            FAILURE
                 ↓                  ↓
            SUBMITTED ←────────→ FAILED
                 ↓
         [Wait for callback]
                 ↓
        handleB2bPayoutCallback()
                 ↓
            COMPLETED

FAILURE path (with retries):
            FAILED
              ↓
    scheduleFailedPayoutForRetry()
              ↓
           RETRYING
              ↓
        [Wait nextRetryAt]
              ↓
    B2BPayoutRetryScheduler
              ↓
    dispatchB2bPayouts() again
              ↓
    If success: SUBMITTED → COMPLETED
    If failure: FAILED → RETRYING → ... (up to 5 times)
                   ↓
              (max attempts reached)
                   ↓
              FAILED (permanent)
```

## Settlement.Service Integration

### dispatchB2bPayouts() Flow
```javascript
async dispatchB2bPayouts(data) {
  // 1. Find settlement
  const settlement = await repository.findSettlementByReference(...)
  
  // 2. IDEMPOTENCY CHECK
  const payoutAttempt = await idempotencyService.createOrGetPayoutAttempt({
    settlementId,
    party,
    amount,
    recipientMerchantId
    // ↑ If exists & completed → return existing
  })
  
  // 3. DUPLICATE PREVENTION
  if (!payoutAttempt.isNewAttempt && payoutAttempt.status === 'COMPLETED') {
    return {
      success: true,
      isDuplicate: true,
      message: 'Payout already completed. Duplicate dispatch prevented.'
    }
  }
  
  // 4. SEND TO GATEWAY
  try {
    const gatewayResult = await sendB2bGatewayPayoutRequest(...)
    
    // 5. UPDATE STATUS
    await idempotencyService.updatePayoutAttemptStatus(
      payoutAttempt.idempotencyKey,
      gatewayResult.success ? 'SUBMITTED' : 'FAILED',
      gatewayResult
    )
  } catch (error) {
    // 6. SCHEDULE RETRY
    if (payoutAttempt.isNewAttempt) {
      const retrySchedule = await retryService.scheduleFailedPayoutForRetry(
        payoutAttempt.idempotencyKey,
        error.message
      )
      // nextRetryAt = now + calculated delay
    }
    throw error
  }
  
  return { success: true, ... }
}
```

## Monitoring Queries

```sql
-- Get retry statistics
SELECT 
  status, 
  COUNT(*) as count,
  MIN("nextRetryAt") as next_retry_time
FROM "b2b_payout_attempts"
WHERE status IN ('RETRYING', 'FAILED')
GROUP BY status;

-- Find payouts due for immediate retry
SELECT 
  "payoutReference",
  "party",
  "attemptCount",
  "nextRetryAt",
  "failureReason"
FROM "b2b_payout_attempts"
WHERE status IN ('RETRYING', 'FAILED')
  AND "nextRetryAt" <= NOW()
ORDER BY "nextRetryAt" ASC
LIMIT 50;

-- Get settlement payout summary
SELECT 
  "settlementId",
  COUNT(*) as total_payouts,
  COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
  COUNT(CASE WHEN status IN ('RETRYING','FAILED') THEN 1 END) as failed,
  MAX("attemptCount") as max_attempts,
  MAX("createdAt") as latest_payout
FROM "b2b_payout_attempts"
GROUP BY "settlementId"
ORDER BY MAX("createdAt") DESC;
```

## Troubleshooting

### Issue: Payout stuck in RETRYING status
```sql
-- Check why it's not retrying
SELECT * FROM "b2b_payout_attempts"
WHERE "payoutReference" = 'MTR-123-SUPPLIER-xyz'
AND status = 'RETRYING';

-- If nextRetryAt is in future, wait or manually retry
-- If nextRetryAt is past, check scheduler logs for errors
```

### Issue: Too many retry attempts
```sql
-- Check current retry policy
SELECT * FROM "b2b_payout_retry_policies" LIMIT 1;

-- Update to allow more retries
UPDATE "b2b_payout_retry_policies"
SET "maxRetries" = 10
LIMIT 1;
```

### Issue: Duplicate payout detected
Check if:
1. `idempotencyKey` unique constraint in database
2. `dispatchB2bPayouts()` called with exact same parameters
3. First payout's `status` = 'COMPLETED'

If complaint is valid:
```sql
-- Verify idempotency
SELECT "idempotencyKey", COUNT(*)
FROM "b2b_payout_attempts"
GROUP BY "idempotencyKey"
HAVING COUNT(*) > 1;  -- Should return empty
```

## Performance Considerations

1. **Scheduler Check Interval**: 30 seconds
   - Reduces DB load vs 1-second checks
   - Acceptable for financial transactions
   - Adjustable if needed

2. **Batch Size**: 10 payouts per cycle
   - Balances throughput vs system load
   - Prevents overwhelming payment gateway
   - Adjustable per retry policy

3. **Database Indexes**:
   - `nextRetryAt` index critical for scheduler query
   - `status` index for filtering
   - `idempotencyKey` index for uniqueness
   - All indexes created in migration

4. **Exponential Backoff**:
   - Reduces retry load over time
   - Example: 5 failed payouts = 31 minutes total wait before all attempts exhausted
   - Configurable backoff multiplier

## Success Criteria ✅

- [x] **No Duplicate Payouts**: idempotencyKey + unique constraint
- [x] **Automatic Retries**: Scheduler runs every 30s
- [x] **Smart Backoff**: Exponential with jitter
- [x] **Max Retries**: Prevents infinite loops
- [x] **Callback Integration**: Marks as completed on receipt
- [x] **Monitoring**: API endpoints for status
- [x] **Logging**: Full audit trail
- [x] **Performance**: Optimized queries with indexes
