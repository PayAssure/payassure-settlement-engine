-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('INITIATED', 'PENDING_PROCESSING', 'PROCESSING', 'PROCESSING_COMPLETE', 'AWAITING_RECONCILIATION', 'COMPLETED', 'PROCESSING_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'PROCESSING', 'PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SALE', 'ADJUSTMENT', 'REFUND', 'DEDUCTION');

-- CreateTable
CREATE TABLE "SettlementSession" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "settlementMethod" TEXT NOT NULL,
    "settlementAccount" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'INITIATED',
    "description" TEXT,
    "bankReference" TEXT,
    "bankTransactionId" TEXT,
    "reconciliationStatus" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "reconciliedAt" TIMESTAMP(3),

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SettlementSession_token_key" ON "SettlementSession"("token");

-- CreateIndex
CREATE INDEX "SettlementSession_businessId_idx" ON "SettlementSession"("businessId");

-- CreateIndex
CREATE INDEX "SettlementSession_integrationId_idx" ON "SettlementSession"("integrationId");

-- CreateIndex
CREATE INDEX "SettlementSession_expiresAt_idx" ON "SettlementSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Settlement_businessId_idx" ON "Settlement"("businessId");

-- CreateIndex
CREATE INDEX "Settlement_integrationId_idx" ON "Settlement"("integrationId");

-- CreateIndex
CREATE INDEX "Settlement_status_idx" ON "Settlement"("status");

-- CreateIndex
CREATE INDEX "Settlement_createdAt_idx" ON "Settlement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_businessId_reference_key" ON "Settlement"("businessId", "reference");

-- CreateIndex
CREATE INDEX "Transaction_settlementId_idx" ON "Transaction"("settlementId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
