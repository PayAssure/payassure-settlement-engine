-- CreateTable
CREATE TABLE "retailer_escrow_floats" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "dailyFloat" DECIMAL(18,2) NOT NULL,
    "expectedRemainingBalance" DECIMAL(18,2) NOT NULL,
    "activeTransferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retailer_escrow_floats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retailer_escrow_transfers" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "retailerEscrowFloatId" TEXT NOT NULL,
    "retailerMerchantId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "requiredBalance" DECIMAL(18,2) NOT NULL,
    "observedBalance" DECIMAL(18,2),
    "balanceOriginatorConversationId" TEXT,
    "balanceConversationId" TEXT,
    "b2bOriginatorConversationId" TEXT,
    "b2bConversationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BALANCE_PENDING',
    "balanceCallback" JSONB,
    "transferCallback" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retailer_escrow_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retailer_escrow_floats_merchantId_key" ON "retailer_escrow_floats"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "retailer_escrow_transfers_balanceOriginatorConversationId_key" ON "retailer_escrow_transfers"("balanceOriginatorConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "retailer_escrow_transfers_b2bOriginatorConversationId_key" ON "retailer_escrow_transfers"("b2bOriginatorConversationId");

-- CreateIndex
CREATE INDEX "retailer_escrow_transfers_retailerMerchantId_status_idx" ON "retailer_escrow_transfers"("retailerMerchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "retailer_escrow_transfers_settlementId_key" ON "retailer_escrow_transfers"("settlementId");

-- AddForeignKey
ALTER TABLE "retailer_escrow_transfers" ADD CONSTRAINT "retailer_escrow_transfers_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retailer_escrow_transfers" ADD CONSTRAINT "retailer_escrow_transfers_retailerEscrowFloatId_fkey" FOREIGN KEY ("retailerEscrowFloatId") REFERENCES "retailer_escrow_floats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
