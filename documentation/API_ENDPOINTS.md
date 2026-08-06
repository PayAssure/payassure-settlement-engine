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

### 7) PATCH /onbordings/:id/activate
- Purpose: Activate a participant onboarding.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - id: string
- Request body: none
- Success response:
  - Status: 200 OK
  - Body: activated participant data
- Error responses:
  - 401 Unauthorized
  - 404 Not Found: participant not found or integration missing

### 8) DELETE /onbordings/:id
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

### 9) PATCH /onbordings/:id/webhook
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

### 10) PATCH /onbordings/:id/payment
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

### 11) PATCH /onbordings/:id/payment/activate
- Purpose: Activate a pending payment destination with a secret.
- Required headers:
  - Authorization: Bearer <jwt>
- Path parameters:
  - id: string
- Request body:
  - paymentActivationSecret: string
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
  - totalAmount: number
  - currency: string
  - settlementMethod: string
  - description: optional string
  - paymentMethod: object with type, payerPhoneNumber, provider
  - callbackUrl: optional string
  - transactionDate: string (ISO 8601)
  - metadata: optional object
  - suppliers: array of supplier allocations
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

---

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
