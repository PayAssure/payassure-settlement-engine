-- AlterTable
ALTER TABLE "retailer_escrow_reconciliations" ADD COLUMN     "retailerMerchantId" TEXT;

-- CreateIndex
CREATE INDEX "retailer_escrow_reconciliations_retailerMerchantId_createdA_idx" ON "retailer_escrow_reconciliations"("retailerMerchantId", "createdAt");
