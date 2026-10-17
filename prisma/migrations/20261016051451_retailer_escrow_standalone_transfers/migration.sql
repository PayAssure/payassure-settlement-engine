-- AlterTable
ALTER TABLE "retailer_escrow_transfers" ADD COLUMN     "merchantTransactionReference" TEXT,
ALTER COLUMN "settlementId" DROP NOT NULL;
