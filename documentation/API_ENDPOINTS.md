# API Endpoints Reference

This document lists the HTTP endpoints exposed by the settlement engine, what each one is for, the payload it expects, and the response shape it returns.

## Common conventions

- Protected endpoints require a bearer JWT in the Authorization header.
- Settlement endpoints that use the one-time settlement session require the x-settlement-session header.
- The supplier directory requires a bearer JWT; supplier settlement lookup requires the x-supplier-session header.
- Internal confirmation endpoints require the following headers:
  - Authorization: Bearer <token>
  - x-payassure-signature
  - x-payassure-timestamp
- All successful responses are JSON. No custom response headers are defined in the controller code; the default Content-Type is application/json.

### Common error body

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "BAD_REQUEST"
}
```

---

## Auth endpoints

Base path: /auth

### 1) POST /auth/register
- Purpose: Create a new admin user.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body:
  - username: string
  - email: string
  - password: string
- Success response:
  - Status: 201 Created
  - Body: registration result returned by the auth service.
- Error responses:
  - 401 Unauthorized: invalid or missing token
  - 403 Forbidden: caller is not a super admin
- Response headers:
  - None custom; standard JSON response

### 2) POST /auth/register-before-onboarding
- Purpose: Create a standard user account before onboarding is complete.
- Required headers: none
- Request body:
  - username: string
  - email: string
  - password: string
- Success response:
  - Status: 201 Created
  - Body: registration result
- Error responses:
  - 409 Conflict: email or username already exists

### 3) POST /auth/onboarded-register
- Purpose: Create or complete a user registration after onboarding.
- Required headers: none
- Request body:
  - username: string
  - email: string
  - password: string
- Success response:
  - Status: 201 Created
  - Body: registration result
- Error responses:
  - 409 Conflict: email or username already exists

### 4) POST /auth/login
- Purpose: Authenticate a user and return tokens.
- Required headers: none
- Request body:
  - identifier: string (email or username)
  - password: string
- Success response:
  - Status: 201 Created
  - Body: authentication payload including access token, refresh token, and user details
- Error responses:
  - 401 Unauthorized: invalid credentials

### 5) GET /auth/users
- Purpose: List users with filtering and pagination.
- Required headers:
  - Authorization: Bearer <jwt>
- Query parameters:
  - role: optional string
  - active: optional boolean-like value
  - search: optional string
  - page: optional number
  - limit: optional number
  - sortBy: optional string
  - sortOrder: optional string
- Success response:
  - Status: 200 OK
  - Body: user list response with pagination and metadata
- Error responses:
  - 401 Unauthorized: missing or invalid token
  - 403 Forbidden: only super admins can access the full list

### 6) POST /auth/refresh
- Purpose: Refresh an access token.
- Required headers: none
- Request body:
  - refreshToken: string
- Success response:
  - Status: 201 Created
  - Body: new access token and refresh token details
- Error responses:
  - 401 Unauthorized: refresh token missing, invalid, or expired

### 7) POST /auth/logout
- Purpose: Invalidate the current refresh token.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: { "message": "Logged out successfully" }
- Error responses:
  - 401 Unauthorized: missing or invalid token

### 8) DELETE /auth/:id
- Purpose: Delete a user account.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - id: string
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: { "message": "User deleted successfully" }
- Error responses:
  - 403 Forbidden: only a super admin can delete another user
  - 404 Not Found: user not found

---

## Escrow Intelligence endpoints

Base path: /escrow

### 1) GET /escrow/health
- Purpose: Check that the escrow intelligence service is running.
- Required headers: none
- Success response:
  - Status: 200 OK
  - Body: service health payload with `ok: true` and `service: "escrow-intelligence"`

### 2) POST /escrow/reconcile
- Purpose: Compare the expected escrow balance against the bank-reported actual balance for a customer.
- Required headers: none
- Request body:
  - customerId: string
  - date: optional ISO date string
- Success response:
  - Status: 200 OK
  - Body: reconciliation result with `status`, `expectedBalance`, `actualBalance`, `delta`, `alerts`, and `blockedSettlement`
- Error responses:
  - 500 Internal Server Error: bank provider call failed or provider returned invalid data

### 3) GET /escrow/summary/:customerId
- Purpose: Return the customer daily escrow summary.
- Required headers: none
- Path parameters:
  - customerId: string
- Query parameters:
  - date: optional ISO date string
- Success response:
  - Status: 200 OK
  - Body: daily expected and actual totals, delta, net movement, and mismatch flag

### 4) GET /escrow/history
- Purpose: Return historical escrow reconciliation attempts.
- Required headers: none
- Success response:
  - Status: 200 OK
  - Body: array of reconciliation records

### 5) GET /escrow/retailer/float
- Purpose: Return the authenticated retailer's float configuration and DB-derived virtual-balance breakdown.
- Required headers:
  - Authorization: Bearer <jwt from /auth/login>
- Path parameters: none. The merchant ID is resolved from the authenticated bearer token.
- Authorization: the JWT user must be active and belong to a `RETAILER` integration.
- Success response:
  - Status: 200 OK
  - Body:
    ```json
    {
      "merchantId": "pay_retailer_001",
      "currency": "KES",
      "dailyFloat": 10000,
      "depositedBalance": 12500,
      "paidOutBalance": 2000,
      "reservedBalance": 1500,
      "availableBalance": 9000,
      "updatedAt": "2026-09-28T19:30:00.000Z"
    }
    ```
- This endpoint reads PayAssure records and does not query Safaricom's shared physical account. For field definitions, request examples, and error cases, see [CASH_SETTLEMENT_FLOW.md](./CASH_SETTLEMENT_FLOW.md#retailer-escrow-api-detailed-endpoint-contracts).
- Error responses:
  - 401 Unauthorized: missing or invalid bearer token.
  - 403 Forbidden: authenticated user is not an active retailer integration owner.
  - 404 Not Found: retailer or float configuration not found.

### 6) POST /escrow/retailer/float/deposits
- Purpose: Start a retailer-specific M-Pesa STK Push to deposit money into the retailer escrow float.
- Required headers:
  - Authorization: Bearer <jwt from /auth/login>
- Authorization: the JWT user must belong to an active retailer integration. The merchant ID is resolved from the token.
- Path parameters: none.
- Request body:
  ```json
  {
    "amount": 5000,
    "payerPhoneNumber": "254700000000"
  }
  ```
- The request uses `MPESA_RETAILER_CONSUMER_KEY`, `MPESA_RETAILER_CONSUMER_SECRET`, `MPESA_RETAILER_SHORTCODE`, and `MPESA_RETAILER_PASSKEY`. It uses PayBill (`CustomerPayBillOnline`), with the normalized payer phone as `PartyA`/`PhoneNumber` and the shortcode as `PartyB`. It does not use the shared customer STK credentials.
- `AccountReference` and `TransactionDesc` are set to the authenticated retailer's registered business name. The deposit ID and callback token are kept in the server-side callback linkage.
- For the complete PayBill field mapping, request/response field definitions, callback lifecycle, and error cases, see [CASH_SETTLEMENT_FLOW.md](./CASH_SETTLEMENT_FLOW.md#retailer-escrow-api-detailed-endpoint-contracts).
- Success response:
  - Status: 201 Created
  - Body includes `depositId`, `merchantId`, `amount`, `status`, `merchantRequestId`, `checkoutRequestId`, and the gateway response fields.
- Balance behavior:
  - Available balance is the sum of `SUCCEEDED` deposit records minus `SUCCEEDED` settlement transfer records.
  - A deposit counts only after its STK callback succeeds and confirms the exact requested amount.
  - Settlement funds are deducted only when the escrow B2B callback marks the transfer `SUCCEEDED`.
  - Failed, mismatched, timed-out, and duplicate callbacks do not change the derived balance.
- Error responses:
  - 400 Bad Request: invalid amount or payer phone number.
  - 401 Unauthorized: missing or invalid bearer token.
  - 403 Forbidden: authenticated user is not an active retailer integration owner.
  - 404 Not Found: retailer integration or float configuration not found.

### 7) POST /escrow/retailer/float/balance
- Purpose: Return the authenticated retailer's virtual balance from PayAssure's database.
- Required headers:
  - Authorization: ****** from /auth/login>
- Authorization: the JWT user must belong to an active retailer integration. The merchant ID is resolved from the token.
- Path parameters and request body: none.
- This compatibility POST route returns the same retailer-specific DB ledger balance as `GET /escrow/retailer/float/balance`. It does not call Safaricom or query the shared physical account.
- Success response:
  - Status: 201 Created (NestJS POST default)
  - Body:
    ```json
    {
      "merchantId": "pay_retailer_001",
      "currency": "KES",
      "depositedBalance": 12500,
      "paidOutBalance": 2000,
      "reservedBalance": 1500,
      "availableBalance": 9000,
      "asOf": "2026-11-04T12:19:29.795Z"
    }
    ```
- Error responses:
  - 401 Unauthorized: missing or invalid bearer token.
  - 403 Forbidden: authenticated user is not an active retailer integration owner.
  - 404 Not Found: retailer float configuration not found.
- See [CASH_SETTLEMENT_FLOW.md](./CASH_SETTLEMENT_FLOW.md#retailer-escrow-api-detailed-endpoint-contracts) for the full balance contract and response field definitions.

### POST /payments/mpesa/escrow-balance
- Purpose: Return the authenticated retailer's virtual balance from the database for compatibility with existing clients.
- Required headers: `Authorization: Bearer <access-token>`.
- The retailer is resolved from the authenticated user. This endpoint does not query Safaricom or return the balance of the shared physical account.
- It returns the same response shape as `GET /escrow/retailer/float/balance`.

### 8) POST /payments/callbacks/mpesa/retailer-escrow-balance
- Purpose: Acknowledge legacy/in-flight Safaricom results for retailer account-balance queries. New retailer balance checks do not initiate this provider query.
- Required headers: none; this callback is called by Safaricom.
- Path parameters and request body: no path parameters; request body is the Account Balance callback payload.
- Processing behavior: the callback is logged and acknowledged; it does not update a retailer's virtual balance. Retailer virtual balances are derived from that retailer's successful deposit and transfer records.

### 9) POST /payments/callbacks/mpesa/retailer-escrow-balance-timeout
- Purpose: Acknowledge a legacy/in-flight Safaricom timeout for a retailer account-balance query.
- Required headers: none; this callback is called by Safaricom.
- Processing behavior: the timeout is logged and acknowledged.

### 10) POST /payments/callbacks/mpesa/retailer-float-deposit/:depositId
- Purpose: Receive the Safaricom STK Push result for a retailer float deposit.
- Required headers: none; this callback is called by Safaricom.
- Path parameters:
  - `depositId`: deposit ID returned by the float deposit initiation endpoint.
- Request body: Safaricom STK callback payload. The service accepts the standard `Body.stkCallback` format and the nested `Result` format used by other M-Pesa callbacks.
- Processing behavior:
  - The STK callback URL includes a per-deposit token; a missing or invalid token is rejected without changing deposit status.
  - `ResultCode === 0` with the exact requested amount: mark the deposit `SUCCEEDED`; it is included in the derived balance.
  - Missing or mismatched amount, or a non-zero result code: mark the deposit `FAILED` and exclude it from the balance.
  - Replayed callback: return a duplicate acknowledgment; the deposit is counted once from its final status.
- Success acknowledgment:
  - Status: 200 OK, including when internal processing records a failure. This prevents unnecessary Safaricom callback redelivery.
  - Body:
    ```json
    {
      "Result": {
        "ResultCode": 0,
        "ResultDesc": "Retailer float deposit callback received"
      },
      "processing": {
        "received": true,
        "status": "SUCCEEDED",
        "receiptNumber": "ABC123XYZ"
      }
    }
    ```
- This callback is isolated from the normal settlement payment callback and never triggers settlement splitting.

## Onboarding endpoints

Base path: /onbordings

### 1) POST /onbordings
- Purpose: Create a retailer or supplier onboarding record.
- Required headers: none
- Request body:
  - participantType: RETAILER | SUPPLIER
  - businessName: string
  - registrationNumber: optional string
  - kraPin: optional string
  - businessType: optional string
  - industry: optional string
  - physicalAddress: optional string
  - contactName: optional string
  - email: optional string
  - phoneNumber: optional string
  - settlementMethod: optional string
  - settlementAccount: optional string
  - posSystem: optional string
  - settlementPreference: optional string
  - payment: optional object with payout destination details
- Success response:
  - Status: 201 Created
  - Body: onboarding creation result
- Error responses:
  - 500 Internal Server Error: unexpected onboarding failure

### 2) POST /onbordings/generate-keys
- Purpose: Generate API keys for the authenticated user.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: onboarding/API key information
- Error responses:
  - 401 Unauthorized
  - 500 Internal Server Error: invalid generated credential data

### 3) GET /onbordings/keys
- Purpose: View API keys for the authenticated user.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: API key details for the current user
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: API keys not found

### 4) GET /onbordings
- Purpose: List onboarding participants.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: array of onboarding participant records
- Error responses:
  - 401 Unauthorized

### 5) GET /onbordings/:id
- Purpose: Get one onboarding participant by id.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - id: string
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: one onboarding participant record
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: participant not found

### 6) PATCH /onbordings/me
- Purpose: Update the onboarding participant associated with the authenticated user.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters: none. The participant is resolved from the decoded JWT email.
- Request body: any updatable onboarding fields
- Success response:
  - Status: 200 OK
  - Body: updated onboarding participant
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: onboarding participant not found for the authenticated user

### 7) DELETE /onbordings/:id
- Purpose: Delete an onboarding participant record.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - id: string
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: { "message": "Participant deleted successfully" }
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: participant not found

### 8) PATCH /onbordings/:id/webhook
- Purpose: Update the webhook URL for a participant integration.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - id: string
- Request body:
  - webhookUrl: absolute HTTP or HTTPS URL
- Success response:
  - Status: 200 OK
  - Body: updated participant data
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: participant not found

Configure an absolute HTTP or HTTPS receiver URL, such as `http://localhost:3010/webhook`, on the retailer integration or its participant fallback. HTTP is intended for development; use HTTPS in production. Settlement webhooks are sent only to the retailer; supplier integrations do not receive them. The integration-specific webhook URL overrides the participant-level URL. See [WEBHOOK_INTEGRATION.md](./WEBHOOK_INTEGRATION.md) for the complete event schema, signature verification, idempotency requirements, retry behavior, and receiver implementation checklist.

### 9) PATCH /onbordings/:id/payment
- Purpose: Update the payout destination for a participant.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - id: string
- Request body:
  - payment: object with payment destination details
- Success response:
  - Status: 200 OK
  - Body: updated participant data
- Error responses:
  - 400 Bad Request
  - 401 Unauthorized
  - 404 Not Found

### 11) PATCH /onbordings/payment/activate
- Purpose: Activate the authenticated user's pending payment destination with a secret.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters: none
- Request body:
  - paymentActivationSecret: string
- Participant lookup: decoded JWT email, the same lookup used by GET /onbordings/me.
- Success response:
  - Status: 200 OK
  - Body: updated participant data
- Error responses:
  - 401 Unauthorized
  - 403 Forbidden: invalid or expired secret

---

## Settlement endpoints

Base path: /settlement

### 1) POST /settlement/authenticate
- Purpose: Authenticate a business and receive a one-time settlement session token.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body:
  - apiKey: string
  - apiSecret: string
- Success response:
  - Status: 200 OK
  - Body:
    ```json
    {
      "success": true,
      "token": "one_time_abc123",
      "expiresIn": 3600,
      "tokenType": "Bearer",
      "business": {
        "id": "business_123",
        "businessName": "ABC Supermarket",
        "participantType": "RETAILER",
        "status": "LIVE"
      }
    }
    ```
- Error responses:
  - 401 Unauthorized: invalid API credentials
  - 403 Forbidden: business not in LIVE status
  - 404 Not Found: business not found

### 2) POST /settlement/initiate-settlement
- Purpose: Initiate a settlement request.
- Required headers:
  - Authorization: Bearer <jwt>
  - x-settlement-session: <token from /settlement/authenticate>
- Request body:
  - merchantId: optional string
  - merchantTransactionReference: string
  - amount: number; must equal the sum of supplierAmount and retailerAmount across items
  - currency: string
  - payment.methods: array of `{ type: CASH | MPESA, amount, phoneNumber? }`; method amounts must total amount
  - items: array of `{ supplierMerchantId, itemReference, supplierAmount, retailerAmount }`
  - metadata: optional but recommended object for invoice, batch, branch, terminal, and audit context
- The retailer POS/ERP sends `supplierAmount` and `retailerAmount` because it owns the commercial transaction facts.
- `merchantTransactionReference` is the only idempotency reference and is unique per retailer.
- The merchant does not send `platformFee`, provider names, callback URLs, or authoritative transaction timestamps.
- PayAssure applies the server-configured `PAYASSURE_PLATFORM_FEE_RATE` as a percentage. The fee is deducted equally from the supplier and retailer allocations. For example, KES 200 + KES 200 at `0.8` percent produces a KES 3.20 fee, so both parties receive KES 198.40.
- PayAssure resolves the merchant callback from onboarding configuration and generates server timestamps.
- The existing legacy fields remain accepted during migration, but new integrations should use this canonical shape.
- Example request:
  ```json
  {
    "merchantId": "pay_retailer_001",
    "merchantTransactionReference": "TXN-MIXED-20260916-000001",
    "amount": 127000,
    "currency": "KES",
    "payment": {
      "methods": [
        { "type": "CASH", "amount": 45000 },
        { "type": "MPESA", "amount": 82000, "phoneNumber": "254791614036" }
      ]
    },
    "items": [
      {
        "supplierMerchantId": "pay_supplier_cement_001",
        "itemReference": "CEMENT-50KG-001",
        "supplierAmount": 38500,
        "retailerAmount": 3250
      },
      {
        "supplierMerchantId": "pay_supplier_steel_002",
        "itemReference": "STEEL-BAR-001",
        "supplierAmount": 32500,
        "retailerAmount": 2700
      },
      {
        "supplierMerchantId": "pay_supplier_electrical_003",
        "itemReference": "ELEC-CABLE-001",
        "supplierAmount": 26500,
        "retailerAmount": 2350
      },
      {
        "supplierMerchantId": "pay_supplier_plumbing_004",
        "itemReference": "PLUMB-PVC-001",
        "supplierAmount": 19500,
        "retailerAmount": 1700
      }
    ],
    "metadata": {
      "batchId": "BATCH-NAIROBI-20260916-001",
      "branchId": "NRB-WESTLANDS-001",
      "terminalId": "POS-WL-07",
      "salesAgentId": "agent-042",
      "invoiceReference": "INV-WL-20260916-00091"
    }
  }
  ```
- Success response:
  - Status: 201 Created
  - Body:
    ```json
    {
      "success": true,
      "settlement": {
        "settlementId": "settlement_123",
        "merchantId": "pay_d68f568ddc7d7b2a",
        "status": "INITIATED",
        "amount": 16500,
        "retailerAmount": 1200,
        "supplierAmount": 15000,
        "systemAmount": 300,
        "paymentDetails": {
          "type": "MPESA",
          "payerPhoneNumber": "254712345678",
          "provider": "Safaricom"
        },
        "currency": "KES",
        "reference": "PASTL-20260706082812-EE8AE32E",
        "createdAt": "2026-07-06T08:28:12.520Z",
        "estimatedProcessingTime": "24-48 hours"
      },
      "message": "Settlement request received and queued for processing",
      "children": []
    }
    ```
- Error responses:
  - 400 Bad Request: invalid payload
  - 401 Unauthorized: invalid token/session
  - 409 Conflict: duplicate settlement reference
  - 500 Internal Server Error

### Settlement history by merchant
- Endpoint: `GET /settlement/merchant/:merchantId`
- Purpose: Return settlement history where the merchant ID was used as the retailer or as a supplier.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - `merchantId`: retailer integration merchant ID or supplier merchant ID stored on a settlement transaction.
- Query parameters:
  - `status`: optional settlement status: `INITIATED`, `PENDING_PROCESSING`, `PROCESSING`, `PROCESSING_COMPLETE`, `AWAITING_RECONCILIATION`, `COMPLETED`, `PROCESSING_FAILED`, or `FAILED`.
  - `from`: optional inclusive `createdAt` ISO 8601 timestamp.
  - `to`: optional exclusive `createdAt` ISO 8601 timestamp.
- Matching behavior:
  - Retailer match: the merchant ID resolves to the settlement's retailer integration.
  - Supplier match: the merchant ID matches `Transaction.supplierMerchantId` for at least one transaction in the settlement.
  - A settlement may report both positions in `matchedPositions`.
  - Transaction results expose `supplierName` from the supplier onboarding record instead of the internal supplier merchant ID.
- Example request:
  ```http
  GET /settlement/merchant/pay_supplier_001?status=COMPLETED&from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z
  Authorization: Bearer <jwt>
  ```
- Success response:
  - Status: 200 OK
  - Body:
    ```json
    {
      "success": true,
      "merchantId": "pay_supplier_001",
      "from": "2026-09-01T00:00:00.000Z",
      "to": "2026-10-01T00:00:00.000Z",
      "count": 1,
      "data": [
        {
          "settlementId": "settlement_123",
          "reference": "PASTL-20260916-001",
          "merchantTransactionReference": "TXN-20260916-000001",
          "status": "COMPLETED",
          "amount": 16500,
          "currency": "KES",
          "settlementMethod": "BANK_TRANSFER",
          "matchedPositions": ["SUPPLIER"],
          "createdAt": "2026-09-16T08:28:12.520Z",
          "processedAt": "2026-09-16T08:30:00.000Z",
          "completedAt": "2026-09-16T08:31:00.000Z",
          "reconciliationStatus": "RECONCILED",
          "bankReference": "BANK-001",
          "transactions": [
            {
              "transactionId": "transaction_456",
              "itemId": "ITEM-CEMENT-001",
              "supplierName": "Acme Supplies Ltd",
              "type": "SUPPLIER",
              "amount": 15000,
              "status": "COMPLETED",
              "description": "Cement supply",
              "createdAt": "2026-09-16T08:28:12.520Z",
              "completedAt": "2026-09-16T08:31:00.000Z"
            }
          ]
        }
      ]
    }
    ```
- Error responses:
  - 400 Bad Request: invalid status, invalid ISO 8601 date, or `from` is not earlier than `to`.
  - 401 Unauthorized: missing or invalid JWT.
  - 404 Not Found: merchant integration not found and no supplier settlement matches the merchant ID.

### 3) POST /settlement/payment-callback
- Purpose: Receive a payment provider callback.
- Required headers: none
- Request body:
  - merchantTransactionReference: string
  - status: optional string
  - provider: optional string
  - providerReference: optional string
  - amount: optional number
  - currency: optional string
  - metadata: optional object
- Success response:
  - Status: 200 OK
  - Body: callback processing result
- Error responses:
  - 404 Not Found: settlement not found

### 4) POST /settlement/payment-confirmation
- Purpose: Confirm a settlement payment from the gateway.
- Required headers:
  - Authorization: Bearer <token>
  - x-payassure-signature
  - x-payassure-timestamp
- Request body:
  - settlementId: string
  - paymentId: optional string
  - status: string
  - provider: optional string
  - paidAmount: optional number
  - paidAt: optional string
  - providerReference: optional object
- Success response:
  - Status: 200 OK
  - Body: confirmation processing result
- Error responses:
  - 401 Unauthorized: missing/invalid token or signature
  - 404 Not Found: settlement not found

### 5) POST /settlement/ledger/simulate-payouts
- Purpose: Simulate ledger-driven payout transactions.
- Required headers: none
- Request body:
  - merchantTransactionReference: string
  - simulationStatus: optional string (PENDING | PAID | FAILED)
- Success response:
  - Status: 200 OK
  - Body: simulation output
- Error responses:
  - 404 Not Found: settlement not found or callback not processed

### 6) POST /settlement/fake-b2b/payout
- Purpose: Accept a fake B2B payout request.
- Required headers: none
- Request body:
  - reference: string
  - fromMerchantId: string
  - toMerchantId: string
  - amount: number
  - currency: string
  - settlementReference: optional string
  - merchantTransactionReference: optional string
  - paymentMethod: optional object
- Success response:
  - Status: 200 OK
  - Body: payout acknowledgement

### 7) POST /settlement/fake-b2b/callback
- Purpose: Receive a fake B2B callback.
- Required headers: none
- Request body:
  - transactionId: string
  - reference: string
  - status: string
  - providerReference: optional string
- Success response:
  - Status: 200 OK
  - Body: callback processing result

### 8) GET /settlement/track/:settlementId
- Purpose: Track the current status of a settlement.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - settlementId: string
- Request body: none
- Success response:
  - Status: 200 OK
  - Body:
    ```json
    {
      "success": true,
      "settlement": {
        "settlementId": "settlement_123",
        "businessId": "business_123",
        "businessName": "ABC Supermarket",
        "status": "PROCESSING",
        "amount": 5000,
        "currency": "KES",
        "reference": "settlement-001",
        "createdAt": "2026-06-30T09:00:00.000Z",
        "transactions": []
      }
    }
    ```
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: settlement not found

### 9) GET /settlement/transactions/:transactionId
- Purpose: Get details for one transaction.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - transactionId: string
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: transaction details object
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: transaction not found

### 10) POST /settlement/reconcile
- Purpose: Reconcile a settlement using bank confirmation info.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body:
  - settlementId: string
  - bankReference: string
  - bankTransactionId: optional string
  - notes: optional string
- Success response:
  - Status: 200 OK
  - Body: reconciliation result
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: settlement not found

### 11) POST /settlement/scenarios/run
- Purpose: Run a documented settlement scenario for testing.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body:
  - scenario: happy-path | invalid-credentials | expired-session | invalid-payload
  - credentialMode: fake | real
  - apiKey: optional string
  - apiSecret: optional string
  - userEmail: optional string
  - merchantTransactionReference: optional string
  - totalAmount: optional number
  - currency: optional string
  - settlementMethod: optional string
  - paymentMethodType: optional string
  - payerPhoneNumber: optional string
  - supplierMerchantId: optional string
  - itemId: optional string
  - supplierAmount: optional number
  - sessionToken: optional string
- Success response:
  - Status: 200 OK
  - Body: scenario status and details
- Error responses:
  - 400 Bad Request: validation failure

---

## Supplier endpoints

Base path: /supplier

### 1) GET /supplier/directory
- Purpose: List registered supplier participants for any authenticated user. Admin or super-admin privileges are not required.
- Required headers:
  - Authorization: Bearer `<JWT access token>` issued by `/auth/login` or `/auth/refresh`
  - Accept: application/json (optional)
- Request body: none
- Success response:
  - Status: 200 OK
  - Body:
    ```json
    {
      "success": true,
      "count": 1,
      "suppliers": [
        {
          "id": "clx123supplier",
          "participantType": "SUPPLIER",
          "merchantId": "pay_supplier_001",
          "businessName": "Example Supplies Ltd",
          "businessType": "LIMITED_COMPANY",
          "contactName": "Alex Example",
          "email": "alex@example.com",
          "phoneNumber": "+254700000123",
          "physicalAddress": "Nairobi, Kenya",
          "status": "ACTIVE",
          "integration": {
            "id": "clx123integration",
            "merchantId": "pay_supplier_001",
            "environment": "production",
            "isActive": true,
            "createdAt": "2026-11-03T03:26:53.655Z"
          },
          "payment": {
            "type": "MPESA",
            "accountName": "Example Supplies",
            "provider": "Safaricom",
            "status": "VERIFIED",
            "isVerified": true,
            "phoneNumber": "****1234"
          },
          "createdAt": "2026-11-03T03:26:53.655Z",
          "updatedAt": "2026-11-03T03:26:53.655Z"
        }
      ]
    }
    ```
- Response fields:
  - `count`: number of supplier records returned.
  - `suppliers`: supplier records sorted by business name.
  - Each supplier includes its participant type, business and contact details, status, timestamps, merchant ID (or `null` if no integration exists), and latest integration metadata (or `null`).
  - The supplier contact `phoneNumber` is returned as stored. Payout identifiers within `payment` are masked: M-Pesa phone numbers and bank account numbers are masked; bank code and shortcode may be included.
  - `payment` is `null` when no supported payout destination is configured. Otherwise it includes the payment type, account name, provider, verification status, and limited destination details.
  - API keys, API secrets, activation secrets, and full payout identifiers are not returned.
- Error responses:
  - 401 Unauthorized: bearer token is missing, expired, revoked, or invalid. A valid token from any active registered user is accepted regardless of role.

### 2) POST /supplier/authenticate
- Purpose: Authenticate a supplier and obtain a supplier session token.
- Required headers:
  - Authorization: Bearer <jwt>
- Request body:
  - apiKey: string
  - apiSecret: string
- Success response:
  - Status: 200 OK
  - Body: supplier authentication result
- Error responses:
  - 401 Unauthorized

### 3) GET /supplier/settlements
- Purpose: List supplier settlements linked to the supplier session.
- Required headers:
  - x-supplier-session: <token from /supplier/authenticate>
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: supplier settlement list
- Error responses:
  - 401 Unauthorized

### 4) GET /supplier/products/:supplierMerchantId
- Purpose: Return item-only product data from the mock retailer connections available to a supplier.
- Required headers: none
- Path parameters:
  - supplierMerchantId: supplier integration merchant ID, for example `pay_supplier_cement_001`
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: supplier merchant ID, connected retailers, and their product items
- Example:
  ```json
  {
    "success": true,
    "supplierMerchantId": "pay_supplier_cement_001",
    "source": "mock-retailer-connection",
    "count": 4,
    "retailers": [
      {
        "retailerMerchantId": "pay_retailer_001",
        "retailerName": "Nairobi BuildMart - Westlands",
        "connected": true,
        "items": [
          {
            "itemId": "ITEM-CEMENT-001",
            "itemReference": "CEMENT-50KG-001",
            "itemName": "Bamburi Cement 50kg",
            "description": "Construction cement",
            "unitPrice": 850,
            "currency": "KES",
            "availableQuantity": 240
          }
        ]
      }
    ]
  }
  ```
- Error responses:
  - 404 Not Found: no mock product catalog exists for the supplier

### 5) GET /supplier/products/:supplierMerchantId/retailer/:retailerMerchantId
- Purpose: Return only the items shared by one connected mock retailer with one supplier.
- Required headers: none
- Path parameters:
  - supplierMerchantId: supplier integration merchant ID
  - retailerMerchantId: connected retailer integration merchant ID, for example `pay_retailer_001`
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: retailer identifiers, connection marker, and item-only product data
- Example:
  ```json
  {
    "success": true,
    "supplierMerchantId": "pay_supplier_cement_001",
    "retailerMerchantId": "pay_retailer_001",
    "retailerName": "Nairobi BuildMart - Westlands",
    "connected": true,
    "source": "mock-retailer-connection",
    "count": 3,
    "items": [
      {
        "itemId": "ITEM-CEMENT-001",
        "itemReference": "CEMENT-50KG-001",
        "itemName": "Bamburi Cement 50kg",
        "description": "Construction cement",
        "unitPrice": 850,
        "currency": "KES",
        "availableQuantity": 240
      }
    ]
  }
  ```
- Error responses:
  - 404 Not Found: no mock supplier-retailer product connection exists

These product endpoints are GET-only. They use mock retailer connection data and do not create or update products, settlements, payment records, or payment statuses.

---

## KCB Funds Transfer

Base path: `/kcb`

### POST /kcb/funds-transfer
- Purpose: Initiate a standalone KCB Funds Transfer API request.
- Required headers:
  - `Content-Type: application/json`
- This is a public PayAssure endpoint and does not require a PayAssure user JWT.
- This endpoint is isolated from settlement initiation, payment callbacks, M-Pesa payout dispatch, and reconciliation. It calls KCB only when explicitly requested.
- PayAssure first calls the KCB token endpoint with Basic Authentication, reads the returned `access_token` and `token_type`, then sends `Authorization: <token_type> <access_token>` to the Funds Transfer endpoint. The token is never returned to the client.
- KCB Funds Transfer is asynchronous. A successful request means KCB accepted the transfer for processing; the final `SUCCESS` or `FAILED` outcome is delivered to the callback URL configured during KCB onboarding.
- Request body:
  - beneficiaryDetails: string
  - companyCode: optional string; defaults to `KCB_COMPANY_CODE`
  - creditAccountNumber: string
  - currency: string
  - debitAccountNumber: optional string; defaults to `KCB_DEBIT_ACCOUNT_NUMBER`
  - debitAmount: positive number
  - paymentDetails: string
  - transactionReference: string
  - transactionType: string
  - beneficiaryBankCode: string
- Example request:
  ```json
  {
    "beneficiaryDetails": "JOHN DOE",
    "companyCode": "KE0010001",
    "creditAccountNumber": "1279287799",
    "currency": "KES",
    "debitAccountNumber": "1279258233",
    "debitAmount": 26,
    "paymentDetails": "UT Fund withdrawal",
    "transactionReference": "FT1234567890",
    "transactionType": "IF",
    "beneficiaryBankCode": "01"
  }
  ```
- Success response: `201 Created` (request accepted for asynchronous processing)
  ```json
  {
    "success": true,
    "provider": "KCB",
    "transactionReference": "FT1234567890",
    "response": {
      "statusCode": "0",
      "statusMessage": "Success",
      "statusDescription": "Request received for processing",
      "merchantID": "263eb626-3fe7-4662-813e-f6f2962219e1",
      "retrievalRefNumber": "PCI663RSS"
    }
  }
  ```
- KCB configuration is server-side only:
  - `KCB_TOKEN_URL` or `KCB_BASE_URL`
  - `KCB_FUNDS_TRANSFER_URL` or `KCB_BASE_URL`
  - `KCB_CONSUMER_KEY`
  - `KCB_CONSUMER_SECRET`
  - `KCB_COMPANY_CODE`
  - `KCB_DEBIT_ACCOUNT_NUMBER`
- The KCB consumer secret, OAuth token, and bearer token must never be sent by the client or committed to the repository.
- Error responses:
  - `400 Bad Request`: invalid transfer body
  - `503 Service Unavailable`: KCB authentication or transfer request failed

## Health endpoint

### GET /payassure/health
- Purpose: Check that the service is alive.
- Required headers: none
- Request body: none
- Success response:
  - Status: 200 OK
  - Body:
    ```json
    {
      "status": "ok"
    }
    ```
- Error responses: none
