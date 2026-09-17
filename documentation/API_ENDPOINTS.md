# API Endpoints Reference

This document lists the HTTP endpoints exposed by the settlement engine, what each one is for, the payload it expects, and the response shape it returns.

## Common conventions

- Protected endpoints require a bearer JWT in the Authorization header.
- Settlement endpoints that use the one-time settlement session require the x-settlement-session header.
- Supplier lookup endpoints require the x-supplier-session header.
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

### 6) PATCH /onbordings/:id
- Purpose: Update an onboarding participant.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - id: string
- Request body: any updatable onboarding fields
- Success response:
  - Status: 200 OK
  - Body: updated onboarding participant
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: participant not found

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
  - webhookUrl: string
- Success response:
  - Status: 200 OK
  - Body: updated participant data
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: participant not found

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

### 1) POST /supplier/authenticate
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

### 2) GET /supplier/settlements
- Purpose: List supplier settlements linked to the supplier session.
- Required headers:
  - x-supplier-session: <token from /supplier/authenticate>
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: supplier settlement list
- Error responses:
  - 401 Unauthorized

### 3) GET /supplier/products/:supplierMerchantId
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

### 4) GET /supplier/products/:supplierMerchantId/retailer/:retailerMerchantId
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
