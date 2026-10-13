ALTER TABLE "retailer_escrow_floats" DROP COLUMN "expectedRemainingBalance";

CREATE INDEX "retailer_escrow_transfers_retailerEscrowFloatId_status_idx"
ON "retailer_escrow_transfers"("retailerEscrowFloatId", "status");