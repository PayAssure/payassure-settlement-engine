-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('RETAILER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('DRAFT', 'DOCUMENTS_SUBMITTED', 'VERIFIED', 'PILOT', 'LIVE', 'REJECTED');

-- CreateTable
CREATE TABLE "OnboardingParticipant" (
    "id" TEXT NOT NULL,
    "participantType" "ParticipantType" NOT NULL,
    "businessName" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "kraPin" TEXT,
    "businessType" TEXT,
    "industry" TEXT,
    "physicalAddress" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phoneNumber" TEXT,
    "settlementMethod" TEXT,
    "settlementAccount" TEXT,
    "posSystem" TEXT,
    "webhookUrl" TEXT,
    "settlementPreference" TEXT,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "apiSecretHash" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "webhookUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_merchantId_key" ON "Integration"("merchantId");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "OnboardingParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
