CREATE TABLE "retailer_escrow_reconciliations" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expectedBalance" DECIMAL(18,2) NOT NULL,
    "observedBalance" DECIMAL(18,2),
    "difference" DECIMAL(18,2),
    "originatorConversationId" TEXT,
    "conversationId" TEXT,
    "callbackBody" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "retailer_escrow_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retailer_escrow_reconciliations_originatorConversationId_key"
ON "retailer_escrow_reconciliations"("originatorConversationId");

CREATE INDEX "retailer_escrow_reconciliations_status_createdAt_idx"
ON "retailer_escrow_reconciliations"("status", "createdAt");