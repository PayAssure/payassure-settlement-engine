/*
  Warnings:

  - You are about to drop the column `isUsed` on the `SettlementSession` table. All the data in the column will be lost.
  - You are about to drop the column `usedAt` on the `SettlementSession` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "SettlementSessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "SettlementSession" DROP COLUMN "isUsed",
DROP COLUMN "usedAt",
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "status" "SettlementSessionStatus" NOT NULL DEFAULT 'ACTIVE';
