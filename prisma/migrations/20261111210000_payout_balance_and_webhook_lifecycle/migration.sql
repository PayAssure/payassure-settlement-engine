ALTER TYPE "B2BPayoutStatus" ADD VALUE IF NOT EXISTS 'SUCCESSFUL';
ALTER TYPE "B2BPayoutStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';

ALTER TABLE "retailer_escrow_transfers"
ADD COLUMN "debitedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

UPDATE "retailer_escrow_transfers"
SET "debitedAmount" = "amount"
WHERE "status" = 'SUCCEEDED';

CREATE INDEX "b2b_payout_attempts_callbackIdentifier_idx"
ON "b2b_payout_attempts"("callbackIdentifier");

CREATE TABLE "settlement_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastResponseStatus" INTEGER,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "settlement_webhook_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_webhook_deliveries_settlementId_fkey"
    FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "settlement_webhook_delivery_attempts" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "responseStatus" INTEGER,
  "error" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "settlement_webhook_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_webhook_delivery_attempts_deliveryId_fkey"
    FOREIGN KEY ("deliveryId") REFERENCES "settlement_webhook_deliveries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "settlement_webhook_deliveries_eventId_key"
ON "settlement_webhook_deliveries"("eventId");
CREATE INDEX "settlement_webhook_deliveries_status_nextAttemptAt_idx"
ON "settlement_webhook_deliveries"("status", "nextAttemptAt");
CREATE INDEX "settlement_webhook_deliveries_settlementId_createdAt_idx"
ON "settlement_webhook_deliveries"("settlementId", "createdAt");
CREATE UNIQUE INDEX "settlement_webhook_delivery_attempts_deliveryId_attemptNumber_key"
ON "settlement_webhook_delivery_attempts"("deliveryId", "attemptNumber");
CREATE INDEX "settlement_webhook_delivery_attempts_deliveryId_attemptedAt_idx"
ON "settlement_webhook_delivery_attempts"("deliveryId", "attemptedAt");
