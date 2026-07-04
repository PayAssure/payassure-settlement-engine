/*
  Warnings:

  - A unique constraint covering the columns `[reference]` on the table `Settlement` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[businessId,merchantTransactionReference]` on the table `Settlement` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `merchantTransactionReference` to the `Settlement` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Settlement_businessId_reference_key";

-- AlterTable
ALTER TABLE "OnboardingParticipant" ADD COLUMN     "payment" JSONB;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "merchantTransactionReference" TEXT NOT NULL,
ADD COLUMN     "paymentPayload" JSONB,
ADD COLUMN     "paymentSnapshot" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_reference_key" ON "Settlement"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_businessId_merchantTransactionReference_key" ON "Settlement"("businessId", "merchantTransactionReference");
