-- CreateTable
CREATE TABLE "retailer_escrow_float_deposits" (
    "id" TEXT NOT NULL,
    "retailerMerchantId" TEXT NOT NULL,
    "retailerEscrowFloatId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "payerPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "callbackToken" TEXT NOT NULL,
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "receiptNumber" TEXT,
    "resultCode" INTEGER,
    "resultDescription" TEXT,
    "requestBody" JSONB,
    "callbackBody" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "retailer_escrow_float_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retailer_escrow_float_deposits_callbackToken_key" ON "retailer_escrow_float_deposits"("callbackToken");

-- CreateIndex
CREATE UNIQUE INDEX "retailer_escrow_float_deposits_checkoutRequestId_key" ON "retailer_escrow_float_deposits"("checkoutRequestId");

-- CreateIndex
CREATE INDEX "retailer_escrow_float_deposits_retailerMerchantId_status_idx" ON "retailer_escrow_float_deposits"("retailerMerchantId", "status");

-- CreateIndex
CREATE INDEX "retailer_escrow_float_deposits_retailerEscrowFloatId_status_idx" ON "retailer_escrow_float_deposits"("retailerEscrowFloatId", "status");

-- AddForeignKey
ALTER TABLE "retailer_escrow_float_deposits" ADD CONSTRAINT "retailer_escrow_float_deposits_retailerEscrowFloatId_fkey" FOREIGN KEY ("retailerEscrowFloatId") REFERENCES "retailer_escrow_floats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;