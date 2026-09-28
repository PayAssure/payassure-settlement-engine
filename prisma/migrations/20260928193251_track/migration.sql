-- AlterTable
ALTER TABLE "retailer_escrow_transfers" ADD COLUMN     "mpesaAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "mpesaPayerPhone" TEXT,
ADD COLUMN     "mpesaStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
