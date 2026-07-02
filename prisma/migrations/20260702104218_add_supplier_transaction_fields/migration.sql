-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "quantity" DECIMAL(12,2),
ADD COLUMN     "supplierMerchantId" TEXT,
ADD COLUMN     "unitPrice" DECIMAL(12,2);
