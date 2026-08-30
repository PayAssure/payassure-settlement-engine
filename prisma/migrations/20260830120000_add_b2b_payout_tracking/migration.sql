-- CreateEnum
CREATE TYPE "B2BPayoutStatus" AS ENUM ('PENDING', 'SUBMITTED', 'COMPLETED', 'FAILED', 'RETRYING');

-- CreateTable b2b_payout_attempts
CREATE TABLE "b2b_payout_attempts" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "merchantTransactionReference" TEXT NOT NULL,
    "payoutReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "party" "ParticipantType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "recipientMerchantId" TEXT,
    "recipientType" TEXT NOT NULL DEFAULT 'MPESA',
    "recipientPhone" TEXT,
    "status" "B2BPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "gatewayResponseCode" TEXT,
    "gatewayResponseDescription" TEXT,
    "gatewayResponse" JSONB,
    "callbackIdentifier" TEXT,
    "callbackReceived" BOOLEAN NOT NULL DEFAULT false,
    "callbackReceivedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextRetryAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "b2b_payout_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable b2b_payout_retry_policies
CREATE TABLE "b2b_payout_retry_policies" (
    "id" TEXT NOT NULL,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "initialDelayMs" INTEGER NOT NULL DEFAULT 60000,
    "maxDelayMs" INTEGER NOT NULL DEFAULT 3600000,
    "backoffMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "b2b_payout_retry_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "b2b_payout_attempts_payoutReference_key" ON "b2b_payout_attempts"("payoutReference");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_payout_attempts_idempotencyKey_key" ON "b2b_payout_attempts"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_payout_attempts_settlementId_party_recipientMerchantId_key" ON "b2b_payout_attempts"("settlementId", "party", "recipientMerchantId");

-- CreateIndex
CREATE INDEX "b2b_payout_attempts_settlementId_idx" ON "b2b_payout_attempts"("settlementId");

-- CreateIndex
CREATE INDEX "b2b_payout_attempts_merchantTransactionReference_idx" ON "b2b_payout_attempts"("merchantTransactionReference");

-- CreateIndex
CREATE INDEX "b2b_payout_attempts_status_idx" ON "b2b_payout_attempts"("status");

-- CreateIndex
CREATE INDEX "b2b_payout_attempts_idempotencyKey_idx" ON "b2b_payout_attempts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "b2b_payout_attempts_nextRetryAt_idx" ON "b2b_payout_attempts"("nextRetryAt");

-- CreateIndex
CREATE INDEX "b2b_payout_attempts_createdAt_idx" ON "b2b_payout_attempts"("createdAt");

-- AddForeignKey
ALTER TABLE "b2b_payout_attempts" ADD CONSTRAINT "b2b_payout_attempts_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
