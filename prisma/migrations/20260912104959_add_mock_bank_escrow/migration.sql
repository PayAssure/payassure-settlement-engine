-- CreateTable
CREATE TABLE "mock_bank_escrow_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "merchantId" TEXT,
    "customerEmail" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "accountType" TEXT NOT NULL DEFAULT 'RETAILER_ESCROW',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_bank_escrow_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_bank_escrow_transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balanceAfter" DECIMAL(18,2) NOT NULL,
    "reference" TEXT,
    "provider" TEXT,
    "scenario" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_bank_escrow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mock_bank_escrow_accounts_customerId_key" ON "mock_bank_escrow_accounts"("customerId");

-- CreateIndex
CREATE INDEX "mock_bank_escrow_transactions_customerId_createdAt_idx" ON "mock_bank_escrow_transactions"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "mock_bank_escrow_transactions" ADD CONSTRAINT "mock_bank_escrow_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "mock_bank_escrow_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
