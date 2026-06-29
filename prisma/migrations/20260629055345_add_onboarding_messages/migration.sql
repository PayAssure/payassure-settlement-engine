-- CreateTable
CREATE TABLE "OnboardingMessage" (
    "id" SERIAL NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingMessage_pkey" PRIMARY KEY ("id")
);
