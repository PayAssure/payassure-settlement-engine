-- CreateTable
CREATE TABLE "mpesa_request_logs" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestBody" JSONB NOT NULL,
    "queryParams" JSONB,
    "pathParams" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mpesa_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mpesa_transactions" (
    "id" TEXT NOT NULL,
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "callbackToken" TEXT,
    "callbackConsumed" BOOLEAN NOT NULL DEFAULT false,
    "amount" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'KES',
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "receiptNumber" TEXT,
    "resultCode" INTEGER,
    "resultDescription" TEXT,
    "customerMessage" TEXT,
    "businessShortCode" TEXT,
    "accountReference" TEXT,
    "phoneNumber" TEXT,
    "requestFingerprint" TEXT,
    "requestBody" JSONB,
    "callbackBody" JSONB,
    "validationFailureReason" TEXT,
    "processingLogs" JSONB,
    "pushFailureReason" TEXT,
    "replayAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastReplayAttemptAt" TIMESTAMP(3),
    "callbackReceivedAt" TIMESTAMP(3),
    "settlementId" TEXT,
    "merchantTransactionReference" TEXT,
    "gatewayPayloadJson" JSONB,
    "settlementNotificationStatus" TEXT DEFAULT 'PENDING',
    "settlementNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "settlementNotificationSentAt" TIMESTAMP(3),
    "settlementNotificationLastAttemptAt" TIMESTAMP(3),
    "settlementNotificationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpesa_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_transactions_checkoutRequestId_key" ON "mpesa_transactions"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_transactions_callbackToken_key" ON "mpesa_transactions"("callbackToken");
