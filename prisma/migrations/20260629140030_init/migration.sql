-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('RETAILER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('DRAFT', 'DOCUMENTS_SUBMITTED', 'VERIFIED', 'PILOT', 'LIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

-- CreateTable
CREATE TABLE "Hello" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "Hello_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "refreshTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingMessage" (
    "id" SERIAL NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_merchantId_key" ON "Integration"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "OnboardingParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
