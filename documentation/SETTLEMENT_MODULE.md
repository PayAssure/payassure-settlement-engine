# Settlement API

This document describes the live settlement and payout endpoints implemented in
`src/settlement/settlement.controller.ts` and
`src/settlement/supplier.controller.ts`.

The route prefixes are `/settlement` and `/supplier`.

## What The Tokens Mean

Settlement uses several different credentials. They are not interchangeable.

| Credential | Where it comes from | Where it is sent | Purpose |
| --- | --- | --- | --- |
| User access JWT | `POST /auth/login` or `POST /auth/refresh` | `Authorization: Bearer <jwt>` | Proves the PayAssure user identity on protected platform routes. |
| Retailer settlement session | `POST /settlement/authenticate` response field `token` | `x-settlement-session: <token>` | Authorizes retailer settlement initiation for 1 hour. |
| Supplier session | `POST /supplier/authenticate` response field `sessionToken` | `x-supplier-session: <sessionToken>` | Authorizes supplier settlement lookup. |
| Internal gateway token | Deployment environment variable `PAYMENT_GATEWAY_API_TOKEN`, otherwise `SETTLEMENT_API_TOKEN`, otherwise `INTERNAL_GATEWAY_TOKEN` | `Authorization: Bearer <token>` | Authenticates internal payment confirmation requests. |
| Internal signature secret | `PAYMENT_GATEWAY_SIGNATURE_SECRET`, otherwise `SETTLEMENT_SIGNATURE_SECRET`, otherwise `PAYASSURE_INTERNAL_SECRET` | Used to create `x-payassure-signature` | Authenticates and protects the internal payment confirmation payload. |
| B2B gateway token | `B2B_GATEWAY_API_TOKEN`, otherwise `PAYMENT_GATEWAY_API_TOKEN`, otherwise `SETTLEMENT_API_TOKEN` | Used by the server when calling the payout gateway | Not a client-facing settlement token. |

### User JWT

Get it from the auth module:

```http
POST /auth/login
Content-Type: application/json
```

```json
{
  "identifier": "merchant-user",
  "password": "strong-password"
}
```

Use the returned `accessToken` for routes protected with `JwtAuthGuard`. It is
not the same as a settlement session token.

### Retailer settlement session

`POST /settlement/authenticate` returns a field named `token`. This token is
created with the `session_...` format and expires after 3600 seconds by default.
It is stored in the settlement-session table with `ACTIVE`, `REVOKED`, or
`EXPIRED` status.

Despite older design notes calling it a one-time token, the current implementation
allows an active token to be reused for multiple initiation requests until it
expires or is revoked. Each valid use updates `lastUsedAt` for auditing. It is
sent in `x-settlement-session`, not in the `Authorization` header.

### Supplier session

`POST /supplier/authenticate` returns `sessionToken` and the same 3600-second
expiry. It is sent only in `x-supplier-session` to `GET /supplier/settlements`.

## Common Error Format

Validation errors from DTOs normally look like this:

```json
{
  "statusCode": 400,
  "message": [
    "totalAmount must not be less than 0.01"
  ],
  "error": "Bad Request",
  "path": "/settlement/initiate-settlement"
}
```

Business errors use this shape:

```json
{
  "statusCode": 401,
  "message": "Invalid or expired one-time token",
  "error": "INVALID_TOKEN"
}
```

Some validation errors include an `errors` array:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "VALIDATION_ERROR",
  "errors": [
    {
      "field": "suppliers[0].supplierMerchantId",
      "message": "Supplier was not found in PayAssure"
    }
  ]
}
```

Protected routes reject a missing, expired, revoked, inactive, or invalid user
JWT with `401 Unauthorized`.

## Recommended Settlement Flow

1. Create or complete the retailer and supplier onboarding records.
2. Verify payout destinations and generate integrations/API credentials.
3. Log in to obtain a user `accessToken`.
4. Call `POST /settlement/authenticate` with the retailer's `apiKey` and
   `apiSecret` to obtain `token`.
5. Call `POST /settlement/initiate-settlement` with both the user JWT and
   `x-settlement-session`.
6. Wait for the payment provider callback or send the authenticated internal
   payment confirmation.
7. Payouts are dispatched to verified supplier and retailer destinations.
8. Receive payout callbacks, track the settlement, inspect retry status, and
   reconcile when the bank confirmation is available.

## Endpoint Inventory

The live API contains these 20 routes:

### Settlement controller

- `POST /settlement/authenticate`
- `POST /settlement/initiate-settlement`
- `POST /settlement/payment-callback`
- `POST /settlement/payment-confirmation`
- `POST /settlement/internal/settlements/payment-confirmation`
- `POST /settlement/payouts/dispatch`
- `POST /settlement/payouts/callback`
- `POST /settlement/payouts/callback/:callbackIdentifier`
- `POST /settlement/payouts/callback/:callbackIdentifier/callbacks/mpesa`
- `GET /settlement/track/:settlementId`
- `GET /settlement/transactions/:transactionId`
- `GET /settlement/merchant/:merchantId`
- `POST /settlement/reconcile`
- `POST /settlement/scenarios/run`
- `GET /settlement/health`
- `POST /settlement/split-and-payout/:merchantTransactionReference`
- `GET /settlement/payouts/retry-status/:settlementId`
- `GET /settlement/payouts/pending-retries`
- `POST /settlement/payouts/manual-retry/:settlementId`

### Supplier controller

- `POST /supplier/authenticate`
- `GET /supplier/settlements`

# Retailer Authentication And Initiation

## 1. Authenticate A Retailer Integration

`POST /settlement/authenticate`

Verifies the API key and API secret for an active integration. The endpoint is
protected by the platform JWT, and the JWT email must match the onboarding
participant email that owns the integration.

### Headers

```http
Authorization: Bearer <user_access_token>
Content-Type: application/json
```

### Request body

```json
{
  "apiKey": "pk_live_abc123",
  "apiSecret": "sk_live_xyz789"
}
```

### Success: `200 OK`

```json
{
  "success": true,
  "token": "session_1725900000000_0123456789abcdef",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "business": {
    "id": "participant-123",
    "businessName": "Fresh Store Ltd",
    "participantType": "RETAILER",
    "status": "ACTIVE"
  }
}
```

The current implementation requires participant status `ACTIVE` here. Older
Swagger descriptions that say `LIVE` are stale.

### Errors

- `400 Bad Request`: `apiKey` or `apiSecret` is missing or has the wrong type.
- `401 Unauthorized`: user JWT is missing or invalid; the JWT email does not
  own the integration (`INVALID_TOKEN_FOR_API_KEYS`); or the secret is wrong
  (`INVALID_CREDENTIALS`).
- `403 Forbidden`: participant is not `ACTIVE` (`BUSINESS_NOT_ACTIVE`).
- `404 Not Found`: no active integration matches the API key
  (`BUSINESS_NOT_FOUND`).

Example:

```json
{
  "statusCode": 401,
  "message": "Invalid API credentials",
  "error": "INVALID_CREDENTIALS"
}
```

## 2. Query Settlements By Merchant ID

`GET /settlement/merchant/:merchantId`

Retrieves all settlements associated with a merchant integration ID. This is useful
for merchant dashboards and audit screens that need to see all settlement records
for one business integration, with optional time filtering.

### Headers

```http
Authorization: Bearer <user_access_token>
Content-Type: application/json
```

### Path parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| merchantId | string | Yes | Merchant ID from the business integration credentials, for example `pay_retailer_001`. |

### Query parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| from | string | No | Inclusive lower bound for `createdAt` in ISO 8601 format. |
| to | string | No | Exclusive upper bound for `createdAt` in ISO 8601 format. |

Example:

```http
GET /settlement/merchant/pay_retailer_001?from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z
```

### Success: `200 OK`

```json
{
  "success": true,
  "merchantId": "pay_retailer_001",
  "from": "2026-09-01T00:00:00.000Z",
  "to": "2026-10-01T00:00:00.000Z",
  "count": 2,
  "data": [
    {
      "settlementId": "setl_123",
      "reference": "SETT-20260901-0001",
      "merchantTransactionReference": "REF-001",
      "status": "COMPLETED",
      "amount": 15000,
      "currency": "KES",
      "settlementMethod": "BANK_TRANSFER",
      "description": "Retailer payout",
      "createdAt": "2026-09-01T12:00:00.000Z",
      "processedAt": "2026-09-01T12:05:00.000Z",
      "completedAt": "2026-09-01T12:10:00.000Z",
      "reconciliationStatus": "VERIFIED",
      "bankReference": "BANK-REF-001",
      "transactions": [
        {
          "transactionId": "txn_001",
          "itemId": "ITEM-001",
          "supplierMerchantId": "SUP-1001",
          "type": "PAYMENT",
          "amount": 15000,
          "status": "COMPLETED",
          "description": "Supplier settlement",
          "createdAt": "2026-09-01T12:00:00.000Z",
          "completedAt": "2026-09-01T12:10:00.000Z"
        }
      ]
    }
  ]
}
```

### Errors

- `400 Bad Request`: `from` is later than or equal to `to`.
- `401 Unauthorized`: missing or invalid user JWT.
- `404 Not Found`: merchant integration does not exist.

### Notes

The endpoint resolves the merchant ID to the matching integration record first,
then returns all settlements linked to that integration. The `from` and `to`
filters are applied to each settlement's `createdAt` value.

## 3. Initiate A Settlement

`POST /settlement/initiate-settlement`

Creates a parent settlement and supplier child settlements, validates supplier
eligibility and amount allocations, and starts customer payment processing.
The route requires both a user JWT and a retailer settlement session.

### Headers

```http
Authorization: Bearer <user_access_token>
x-settlement-session: <token_from_settlement_authenticate>
Content-Type: application/json
```

### Request body

```json
{
  "merchantId": "pay_retailer_001",
  "merchantTransactionReference": "TXN-20260910-000001",
  "totalAmount": 16500,
  "currency": "KES",
  "settlementMethod": "BANK_TRANSFER",
  "description": "Daily sales batch",
  "paymentMethod": {
    "type": "MPESA",
    "payerPhoneNumber": "254712345678",
    "provider": "Safaricom"
  },
  "callbackUrl": "https://merchant.example.com/payassure/callback",
  "transactionDate": "2026-09-10T17:30:15+03:00",
  "metadata": {
    "branchId": "BR-01",
    "terminalId": "POS-03"
  },
  "suppliers": [
    {
      "supplierMerchantId": "pay_supplier_001",
      "supplierTotalAmount": 15000,
      "retailerTotalAmount": 1200,
      "platformFee": 300,
      "items": [
        {
          "itemId": "ITEM-001",
          "itemName": "Product A",
          "supplierAmount": 15000,
          "quantity": 5,
          "unitPrice": 3000,
          "description": "Product A sales"
        }
      ]
    }
  ]
}
```

### Request field rules

| Field | Required | Rules and meaning |
| --- | --- | --- |
| `merchantId` | No | Retailer merchant ID. The authenticated integration is the authoritative retailer context. |
| `merchantTransactionReference` | Yes | Your idempotency/business reference. Reusing it for the same retailer returns the existing settlement. |
| `totalAmount` | Yes | Number greater than `0.01`. Must equal supplier allocation totals within `0.01`. |
| `currency` | Yes | Current supported values are `KES`, `USD`, and `TZS`. |
| `settlementMethod` | Yes | Non-empty string such as `BANK_TRANSFER`. |
| `paymentMethod.type` | Yes | `MPESA`, `BANK`, or `CASH` for the customer payment. |
| `paymentMethod.payerPhoneNumber` | Required for MPESA | Customer's phone number used for the STK push. It is not the supplier payout phone. |
| `paymentMethod.phoneNumber` | Optional | Accepted by the DTO, but the STK flow reads `payerPhoneNumber`. Send `payerPhoneNumber` for MPESA. |
| `transactionDate` | Yes | Valid ISO 8601 timestamp. |
| `suppliers` | Yes | At least one supplier allocation. |
| `supplierMerchantId` | Yes per group | Must resolve to an active supplier integration with a verified payout destination. |
| `items` | No | If present, supplier amount is computed from item `supplierAmount` values. |
| `supplierTotalAmount` | No | Supplier-level total when items are omitted, or a consistency total when items are present. |
| `retailerTotalAmount` | No | Retailer allocation for the supplier group; cannot be negative. |
| `platformFee` | No | Platform allocation; cannot be negative. |
| `metadata` | No | JSON metadata retained with the settlement. Avoid secrets. |

The total calculation is:

```text
settlement total = supplier amounts + retailer amounts + platform fees
```

When `items` are present, `supplierAmount` is calculated from the item values.
The `supplierTotalAmount` must match that calculated amount. Amounts are compared
with a tolerance of `0.01`.

### Success: `201 Created`

```json
{
  "success": true,
  "settlement": {
    "settlementId": "clxsettlement123",
    "merchantId": "pay_retailer_001",
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
    "reference": "PASTL-20260910083000-EE8AE32E",
    "createdAt": "2026-09-10T08:30:00.000Z",
    "estimatedProcessingTime": "24-48 hours"
  },
  "message": "Settlement request received and queued for processing",
  "children": [
    {
      "id": "clxchild123",
      "reference": "TXN-20260910-000001-pay_supplier_001-0",
      "supplier": {
        "amount": 15000,
        "paymentDetails": {
          "type": "BANK",
          "accountName": "Supplier Ltd",
          "provider": "Example Bank",
          "bankCode": "07",
          "accountNumber": "1234567890",
          "shortcode": "600000"
        }
      },
      "retailer": {
        "amount": 1200,
        "paymentDetails": {
          "type": "MPESA",
          "payerPhoneNumber": "254712345678",
          "provider": "Safaricom"
        }
      },
      "systemAmount": 300,
      "amount": 16500
    }
  ]
}
```

If some supplier groups are invalid but at least one is eligible, the invalid
groups are excluded, `totalAmount` is recalculated, and the response includes an
`excludedSuppliers` array. The request is not rejected solely because one group
is invalid.

If the same `merchantTransactionReference` already exists for the authenticated
retailer, the endpoint returns `200 OK` with:

```json
{
  "success": true,
  "message": "Settlement already processed for this merchant transaction reference",
  "settlement": {
    "settlementId": "clxsettlement123",
    "status": "INITIATED",
    "amount": 16500,
    "currency": "KES",
    "reference": "PASTL-20260910083000-EE8AE32E",
    "estimatedProcessingTime": "10 minutes"
  }
}
```

### Errors

#### Session and authorization errors

- `401 INVALID_TOKEN`: session not found.
- `401 TOKEN_EXPIRED`: session expiry has passed.
- `401 SESSION_INACTIVE`: session is revoked or not `ACTIVE`.
- `401 INVALID_SESSION`: session integration or retailer context cannot be
  loaded.
- `403 RETAILER_NOT_AUTHORIZED`: session integration is not a retailer, or the
  retailer is not `ACTIVE` or `LIVE`.

#### Validation errors

- `400 VALIDATION_ERROR`: general validation failure with an `errors` array.
- `400 NO_ELIGIBLE_SUPPLIERS`: every supplier group was invalid; includes
  `invalidSuppliers`.
- `400`: total amount is not greater than zero.
- `400`: unsupported currency, missing payment method, invalid timestamp, or no
  supplier allocations.
- `400`: MPESA has no `payerPhoneNumber`.
- `400`: supplier merchant ID is missing, unknown, inactive, not a supplier,
  has no payout destination, or has an unverified payout destination.
- `400`: supplier totals do not equal item totals or the request total does not
  equal the allocation total.

#### Other errors

- `409 Conflict`: documented for duplicate references, but current duplicate
  handling normally returns the existing settlement with `200`.
- `500 INITIATION_FAILED`: unexpected persistence or processing failure.

## Payment And Settlement Progression

The settlement commonly moves through these database statuses:

| Status | Meaning |
| --- | --- |
| `INITIATED` | Request accepted; customer payment may still be pending or a retryable gateway failure is being held. |
| `PENDING_PROCESSING` | Payment callback or internal payment confirmation was accepted and allocation is beginning. |
| `PROCESSING` | Ledger allocation or payout processing is underway. |
| `PROCESSING_COMPLETE` | Processing stage completed where this status is used by downstream workflows. |
| `AWAITING_RECONCILIATION` | Waiting for bank or financial reconciliation. |
| `COMPLETED` | Settlement has been reconciled/completed. |
| `PROCESSING_FAILED` | Processing failed in a downstream workflow. |
| `FAILED` | Settlement or payout processing failed permanently. |

# Payment Callbacks And Confirmation

## 3. Payment Provider Callback

`POST /settlement/payment-callback`

Receives a payment provider callback and changes the linked settlement to
`PENDING_PROCESSING`. This route has no JWT guard because it is called by the
payment provider or a payment callback adapter.

### Request body

```json
{
  "merchantTransactionReference": "TXN-20260910-000001",
  "status": "SUCCESS",
  "provider": "M-PESA",
  "providerReference": "MPESA-12345",
  "amount": 16500,
  "currency": "KES",
  "metadata": {
    "checkoutRequestId": "ws_CO_123"
  }
}
```

`merchantTransactionReference` is required. Other fields are optional. The
service defaults `status` to `SUCCESS` when omitted.

### Success: `200 OK`

```json
{
  "success": true,
  "status": "PENDING_PROCESSING",
  "message": "Payment callback received. The settlement is now moving into ledger allocation and payout processing.",
  "settlementId": "clxsettlement123",
  "nextStep": "Create ledger entries and split the customer funds into supplier, retailer, and platform allocations.",
  "allocationPlan": {
    "customerReceived": 16500,
    "allocations": [
      { "party": "Supplier", "amount": 15000, "destination": "B2B payout", "status": "PENDING" },
      { "party": "Retailer", "amount": 1200, "destination": "B2B payout", "status": "PENDING" },
      { "party": "Platform", "amount": 300, "destination": "Retained fee", "status": "PENDING" }
    ]
  }
}
```

### Errors

- `400 Bad Request`: missing or invalid callback payload.
- `404 SETTLEMENT_NOT_FOUND`: no settlement matches the merchant transaction
  reference.

## 4. Internal Payment Confirmation

`POST /settlement/payment-confirmation`

Confirms a customer payment from the internal payment gateway and advances the
settlement into allocation and payout dispatch. The legacy alias
`POST /settlement/internal/settlements/payment-confirmation` runs the same logic.

This endpoint does not use `JwtAuthGuard`. It uses an application bearer token,
a shared HMAC secret, and a Unix timestamp.

### Headers

```http
Authorization: Bearer <PAYMENT_GATEWAY_API_TOKEN>
x-payassure-signature: <hmac_sha256_hex>
x-payassure-timestamp: <unix_seconds>
Content-Type: application/json
```

### Request body

```json
{
  "settlementId": "clxsettlement123",
  "paymentId": "payment-123",
  "status": "PAID",
  "provider": "MPESA",
  "paidAmount": 16500,
  "paidAt": "2026-09-10T08:45:00.000Z",
  "providerReference": {
    "checkoutRequestId": "ws_CO_123",
    "merchantRequestId": "ws_MR_123",
    "receiptNumber": "QAB123456"
  }
}
```

`settlementId` and `status` are required by the DTO. The service accepts only
`PAID` for a new confirmation. A confirmation for a settlement already in
`PENDING_PROCESSING`, `PROCESSING`, or `COMPLETED` is treated as an idempotent
success.

### Signature construction

The signature is HMAC-SHA256 using the configured internal secret. Sign exactly
this JSON object, with the same property values and JSON serialization order:

```javascript
const signedBody = JSON.stringify({
  paymentId: body.paymentId,
  settlementId: body.settlementId,
  status: body.status,
  provider: body.provider,
  paidAmount: body.paidAmount,
  paidAt: body.paidAt,
});

const signature = crypto
  .createHmac('sha256', INTERNAL_SIGNATURE_SECRET)
  .update(signedBody)
  .digest('hex');
```

The timestamp is not included in the HMAC body, but it must be a valid Unix
seconds value within 300 seconds of server time.

### Success: `200 OK`

Already-confirmed response:

```json
{
  "success": true,
  "status": "PROCESSING",
  "message": "Payment confirmation was already processed for this settlement.",
  "settlementId": "clxsettlement123"
}
```

New confirmation response:

```json
{
  "success": true,
  "status": "PENDING_PROCESSING",
  "message": "Payment confirmation accepted. The settlement is now processing B2B payout dispatch.",
  "settlementId": "clxsettlement123",
  "nextStep": "Dispatch B2B payouts to supplier and retailer and wait for payout callbacks.",
  "allocationPlan": {},
  "dispatchResults": []
}
```

### Errors

All authentication failures use `401 UNAUTHORIZED`:

- `Missing bearer token`
- `Invalid bearer token`
- `Signature secret is not configured`
- `Missing signature headers`
- `Invalid signature`
- `Expired or invalid timestamp`

Other errors:

- `400 INVALID_PAYMENT_STATUS`: only `PAID` confirmations are accepted.
- `400 Bad Request`: DTO validation failure.
- `404 SETTLEMENT_NOT_FOUND`: settlement ID or fallback reference was not found.

# Payout Dispatch And Callbacks

## 5. Dispatch A B2B Payout

`POST /settlement/payouts/dispatch`

Dispatches a payout to a supplier or retailer after successful customer payment
confirmation. This route currently has no JWT or application-token guard, so it
must be protected at the network/API gateway layer before production exposure.

### Request body

```json
{
  "merchantTransactionReference": "TXN-20260910-000001",
  "party": "SUPPLIER",
  "supplierMerchantId": "pay_supplier_001",
  "amount": 15000,
  "payoutReference": "PAYOUT-REF-1",
  "metadata": {
    "operator": "settlement-worker"
  }
}
```

Field notes:

- `party` is `SUPPLIER` or `RETAILER`; default is `SUPPLIER`.
- `supplierMerchantId` identifies the supplier for supplier payouts. Retailer
  merchant ID is resolved from the settlement's authenticated retailer
  integration.
- If `amount` is zero or omitted, the service tries the matching allocation
  amount. If that is also zero, the request fails.
- The payout cannot proceed until a successful payment callback or confirmation
  is recorded (`PAYMENT_NOT_CONFIRMED`).
- MPESA payout destinations route through B2C and require a phone number.
- BANK payout destinations route through B2B and require `shortcode` and
  `accountName`.

### Success: `200 OK`

```json
{
  "success": true,
  "status": "SUBMITTED",
  "payoutReference": "TXN-20260910-000001-SUPPLIER-1725900000-a1b2c3",
  "gatewayResult": {
    "success": true,
    "statusCode": 200,
    "responseCode": "0",
    "responseDescription": "Accepted",
    "response": {}
  },
  "dispatchRecord": {
    "reference": "TXN-20260910-000001-SUPPLIER-1725900000-a1b2c3",
    "party": "SUPPLIER",
    "status": "SUBMITTED",
    "amount": 15000,
    "callbackIdentifier": "uuid-callback-id"
  }
}
```

Possible gateway result statuses:

- `SUBMITTED`: gateway accepted the request (`responseCode` is `0`).
- `FAILED`: gateway returned a non-success response; the returned HTTP response
  can still be `200` with `success: false`.
- `COMPLETED`: duplicate dispatch detected after a previous callback completed
  the payout. The response includes `isDuplicate: true`.

### Errors

- `404 PAYMENT_NOT_CONFIRMED`: no successful payment callback or confirmation.
- `400 SUPPLIER_MERCHANT_ID_REQUIRED`: supplier payout has no supplier merchant
  ID.
- `400 RETAILER_PAYMENT_NOT_CONFIGURED`: retailer payout destination is missing.
- `400 SUPPLIER_PAYMENT_NOT_CONFIGURED`: supplier payout destination is missing.
- `404 SUPPLIER_PAYMENT_NOT_FOUND`: supplier integration or participant cannot
  be found.
- `400 BANK_PAYOUT_DETAILS_INCOMPLETE`: BANK payout lacks `shortcode` or
  `accountName`.
- `400 MPESA_PAYOUT_DETAILS_INCOMPLETE`: MPESA payout lacks a recipient phone.
- `400 INVALID_PAYOUT_AMOUNT`: amount and allocation are both zero or negative.
- `404 SETTLEMENT_NOT_FOUND`: merchant transaction reference is unknown.
- `404 RETAILER_NOT_FOUND`: retailer participant cannot be resolved.

## 6. B2B Payout Callback

The provider may call any of these equivalent routes:

- `POST /settlement/payouts/callback`
- `POST /settlement/payouts/callback/:callbackIdentifier`
- `POST /settlement/payouts/callback/:callbackIdentifier/callbacks/mpesa`

No JWT is required. The provider callback should use the URL generated in the
payout request. The path identifier is preferred for lookup; the service falls
back to callback identifiers, merchant references, provider references, or
transaction IDs in the body.

### Flat callback body

```json
{
  "merchantTransactionReference": "TXN-20260910-000001",
  "party": "SUPPLIER",
  "supplierMerchantId": "pay_supplier_001",
  "reference": "TXN-20260910-000001-SUPPLIER-1725900000-a1b2c3",
  "status": "SUCCESS",
  "providerReference": "GW-12345",
  "transactionId": "UHHRY0DHFK",
  "amount": 15000,
  "metadata": {}
}
```

### Nested M-Pesa callback body

The callback pipe transforms this provider format:

```json
{
  "Result": {
    "ResultCode": 0,
    "ResultDesc": "The service request is processed successfully.",
    "TransactionID": "UHHRY0DHFK",
    "OriginatorConversationID": "oc-123",
    "ConversationID": "c-123"
  }
}
```

Into the internal flat fields. `ResultCode: 0` becomes `status: SUCCESS`; any
other result code becomes `status: FAILED`. `TransactionID` becomes the
transaction/reference fallback and provider reference.

### Success: `200 OK`

```json
{
  "success": true,
  "status": "PROCESSING",
  "settlementId": "clxsettlement123",
  "payoutCallback": {
    "reference": "TXN-20260910-000001-SUPPLIER-1725900000-a1b2c3",
    "party": "SUPPLIER",
    "status": "PAID",
    "providerReference": "GW-12345",
    "amount": 15000,
    "processedAt": "2026-09-10T09:00:00.000Z"
  }
}
```

The callback maps provider `SUCCESS` or `PAID` to payout status `PAID`; all
other statuses become `FAILED`. A successful payout callback updates the
idempotency record as completed.

### Errors

- `400 Bad Request`: invalid callback field types or unsupported `party`/`status`.
- `404 SETTLEMENT_NOT_FOUND`: payout callback reference cannot be resolved.

## 7. Split And Payout Debug Route

`POST /settlement/split-and-payout/:merchantTransactionReference`

This is a test/debug route with no authentication guard. It manually simulates a
successful payment callback, calculates allocations, and attempts supplier and
retailer payouts.

### Request body

```json
{
  "mpesaReceipt": "QAB123456",
  "mpesaCheckoutRequestId": "ws_CO_123",
  "mpesaMerchantRequestId": "ws_MR_123",
  "resultCode": 0,
  "resultDesc": "Manual trigger"
}
```

### Success: `200 OK`

```json
{
  "success": true,
  "message": "Split and payout dispatch initiated",
  "data": {
    "status": "PROCESSING",
    "settlementId": "clxsettlement123",
    "dispatchResults": {}
  }
}
```

Possible data statuses are `PROCESSING`, `PARTIALLY_FAILED`, and `FAILED`.
`404 SETTLEMENT_NOT_FOUND` is returned when the path reference is unknown.
`400 INVALID_SETTLEMENT_PAYLOAD` is returned when the settlement has no stored
payment payload.

# Supplier API

## 8. Authenticate A Supplier

`POST /supplier/authenticate`

Authenticates a supplier integration with a platform JWT, API key, and API
secret. The integration must belong to a supplier with status `ACTIVE`.

### Headers and body

```http
Authorization: Bearer <user_access_token>
Content-Type: application/json
```

```json
{
  "apiKey": "pk_live_supplier123",
  "apiSecret": "sk_live_supplier789"
}
```

### Success: `200 OK`

```json
{
  "success": true,
  "sessionToken": "session_1725900000000_0123456789abcdef",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "business": {
    "id": "supplier-participant-123",
    "businessName": "Supplier Ltd",
    "participantType": "SUPPLIER",
    "status": "ACTIVE"
  }
}
```

### Errors

- `401 INVALID_TOKEN_FOR_API_KEYS`: JWT email does not own the integration.
- `401 INVALID_CREDENTIALS`: supplier API secret is incorrect.
- `404 SUPPLIER_NOT_FOUND`: no active integration matches the API key.
- `403 NOT_A_SUPPLIER`: integration belongs to a retailer.
- `403 SUPPLIER_NOT_ACTIVE`: supplier participant is not active.

## 9. List Supplier Settlements

`GET /supplier/settlements`

Returns settlement summaries allocated to the supplier identified by the
supplier session token.

### Headers

```http
x-supplier-session: <sessionToken_from_supplier_authenticate>
```

### Success: `200 OK`

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "reference": "TXN-20260910-000001-pay_supplier_001-0",
      "merchantTransactionReference": "MTXN-20260910083000-A1B2C3",
      "amount": 15000,
      "status": "INITIATED",
      "retailerMerchantId": "pay_retailer_001",
      "itemReference": "ITEM-001"
    }
  ]
}
```

### Errors

- `401 INVALID_SUPPLIER_SESSION`: missing, unknown, or invalid session context.
- `401 SUPPLIER_SESSION_EXPIRED`: session expiry has passed.
- `403 NOT_A_SUPPLIER_SESSION`: session belongs to a non-supplier integration.

# Tracking And Reconciliation

## 10. Track A Settlement

`GET /settlement/track/:settlementId`

Requires a platform user JWT. The controller method declares a `view` parameter,
but it is not decorated with `@Query`; HTTP callers therefore receive the
default `retailer` view. The service supports `retailer`, `supplier`, and
`payassure` views when called internally.

### Success: `200 OK`

```json
{
  "success": true,
  "view": "retailer",
  "settlement": {
    "settlementId": "clxsettlement123",
    "reference": "PASTL-20260910083000-EE8AE32E",
    "merchantTransactionReference": "MTXN-20260910083000-A1B2C3",
    "status": "PROCESSING",
    "currency": "KES",
    "createdAt": "2026-09-10T08:30:00.000Z",
    "processedAt": null,
    "estimatedCompletionTime": "2026-09-12T08:30:00.000Z",
    "timeline": [
      { "status": "INITIATED", "timestamp": "2026-09-10T08:30:00.000Z" },
      { "status": "ALLOCATED", "timestamp": "2026-09-10T08:30:00.000Z" },
      { "status": "PENDING_PAYOUT", "timestamp": "2026-09-10T08:30:00.000Z" }
    ],
    "amounts": {
      "total": 16500,
      "supplier": 15000,
      "retailer": 1200,
      "platformFee": 300
    },
    "customerPayment": { "type": "MPESA" },
    "suppliers": [],
    "transactions": []
  }
}
```

### Errors

- `401 Unauthorized`: invalid or missing user JWT.
- `404 SETTLEMENT_NOT_FOUND`: settlement ID does not exist.

## 11. Get Transaction Details

`GET /settlement/transactions/:transactionId`

Requires a platform user JWT.

### Success: `200 OK`

```json
{
  "success": true,
  "transaction": {
    "transactionId": "clxtransaction123",
    "settlementId": "clxsettlement123",
    "itemId": "ITEM-001",
    "type": "SALE",
    "amount": 15000,
    "currency": "KES",
    "status": "INITIATED",
    "description": "Product A sales",
    "createdAt": "2026-09-10T08:30:00.000Z",
    "completedAt": null
  }
}
```

If the repository cannot find the transaction, the current implementation
returns a synthetic success response with `status: UNKNOWN`, `amount: 0`, and
description `Synthetic fallback transaction`; it does not currently return the
controller-documented `404`.

## 12. Query Settlements By Merchant ID

`GET /settlement/merchant/:merchantId`

Returns settlements created through the integration identified by the supplied
merchant ID. This route requires a platform user JWT.

### Headers

```http
Authorization: Bearer <user_access_token>
```

### Path parameter

- `merchantId`: merchant ID from the onboarding integration credentials, for
  example `pay_retailer_001`.

### Optional query parameters

- `from`: ISO 8601 timestamp, inclusive. Filters the settlement `createdAt`
  field.
- `to`: ISO 8601 timestamp, exclusive. Filters the settlement `createdAt`
  field.

Example:

`GET /settlement/merchant/pay_retailer_001?from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z`

Both filters may be omitted:

`GET /settlement/merchant/pay_retailer_001`

### Success: `200 OK`

```json
{
  "success": true,
  "merchantId": "pay_retailer_001",
  "from": "2026-09-01T00:00:00.000Z",
  "to": "2026-10-01T00:00:00.000Z",
  "count": 1,
  "data": [
    {
      "settlementId": "clxsettlement123",
      "reference": "PASTL-20260910083000-EE8AE32E",
      "merchantTransactionReference": "MTXN-20260910083000-A1B2C3",
      "status": "COMPLETED",
      "amount": 16500,
      "currency": "KES",
      "settlementMethod": "BANK_TRANSFER",
      "description": "Daily sales batch",
      "createdAt": "2026-09-10T08:30:00.000Z",
      "processedAt": "2026-09-10T09:00:00.000Z",
      "completedAt": "2026-09-10T10:00:00.000Z",
      "reconciliationStatus": "VERIFIED",
      "bankReference": "BANK_REF_001",
      "transactions": [
        {
          "transactionId": "clxtransaction123",
          "itemId": "ITEM-001",
          "supplierMerchantId": "pay_supplier_001",
          "type": "SALE",
          "amount": 15000,
          "status": "COMPLETED",
          "description": "Product A sales",
          "createdAt": "2026-09-10T08:30:00.000Z",
          "completedAt": "2026-09-10T09:00:00.000Z"
        }
      ]
    }
  ]
}
```

Results are ordered newest first. If no settlements match the merchant or time
window, the endpoint returns `200` with `count: 0` and an empty `data` array.

### Errors

- `400 Bad Request`: `from` or `to` is not a valid ISO 8601 timestamp, or
  `from` is greater than or equal to `to`; inverted ranges use error code
  `INVALID_DATE_RANGE`.
- `401 Unauthorized`: missing, expired, revoked, or invalid user JWT.
- `404 Not Found`: no integration exists for the merchant ID; error code
  `MERCHANT_NOT_FOUND`.

The lookup uses the integration's `merchantId`, not a settlement ID or the
caller-provided `merchantId` stored inside the settlement payment payload.
The current implementation requires a valid user JWT but does not yet restrict
the requested merchant ID to the merchant owned by that JWT; add an ownership
or administrator authorization check before exposing this route to untrusted
users.

## 13. Reconcile A Settlement

`POST /settlement/reconcile`

Marks an existing settlement as completed and stores bank reconciliation data.
Requires a platform user JWT.

### Request body

```json
{
  "settlementId": "clxsettlement123",
  "bankReference": "BANK_REF_001",
  "bankTransactionId": "BANK_TXN_987654",
  "notes": "Settlement completed successfully."
}
```

`settlementId` and `bankReference` are required. `notes` is accepted by the DTO
but is not persisted by the current reconciliation operation.

### Success: `200 OK`

```json
{
  "success": true,
  "settlement": {
    "settlementId": "clxsettlement123",
    "status": "COMPLETED",
    "reconciliationStatus": "VERIFIED",
    "reconciliationDetails": {
      "bankReference": "BANK_REF_001",
      "reconcileAt": "2026-09-10T10:00:00.000Z"
    }
  }
}
```

### Errors

- `400 Bad Request`: required fields are missing or invalid.
- `401 Unauthorized`: invalid or missing user JWT.
- `404 SETTLEMENT_NOT_FOUND`: settlement does not exist.

# Health, Scenarios, And Retry Operations

## 14. Settlement Health

`GET /settlement/health`

Public health response:

```json
{
  "status": "ok"
}
```

Returns `200 OK` when the controller is running.

## 15. Run A Documented Scenario

`POST /settlement/scenarios/run`

Requires a platform user JWT. This is intended for Swagger/manual testing, not
for production business traffic.

### Request body

```json
{
  "scenario": "happy-path",
  "credentialMode": "fake",
  "apiKey": "pk_live_test123",
  "apiSecret": "sk_live_test123",
  "userEmail": "merchant@example.com",
  "merchantTransactionReference": "TXN-SCENARIO-001",
  "totalAmount": 7200,
  "currency": "KES",
  "settlementMethod": "BANK_TRANSFER",
  "paymentMethodType": "MPESA",
  "payerPhoneNumber": "254700000000",
  "supplierMerchantId": "SUP-1001",
  "itemId": "ITEM-001",
  "supplierAmount": 7200
}
```

`scenario` values:

- `happy-path`
- `invalid-credentials`
- `expired-session`
- `invalid-payload`

`credentialMode` is `fake` or `real`. Defaults are supplied for omitted fields.

### Success: `200 OK`

```json
{
  "status": "passed",
  "scenario": "happy-path",
  "message": "Happy-path settlement scenario completed successfully.",
  "details": {
    "credentialMode": "fake",
    "settlementId": "clxsettlement123",
    "merchantTransactionReference": "TXN-SCENARIO-001",
    "token": "session_..."
  }
}
```

An intentionally rejected scenario can still return `status: passed` because it
means the expected rejection occurred. Validation of the scenario request itself
returns `400`.

## 16. Get Retry Status

`GET /settlement/payouts/retry-status/:settlementId`

No authentication guard is currently attached. Protect this route externally.

### Success: `200 OK`

```json
{
  "success": true,
  "settlementId": "clxsettlement123",
  "retryStatistics": {
    "totalPayouts": 2,
    "completed": 1,
    "submitted": 0,
    "pending": 0,
    "retrying": 1,
    "failed": 0,
    "totalAttempts": 3,
    "averageAttempts": 1.5
  },
  "timestamp": "2026-09-10T10:00:00.000Z"
}
```

The current implementation returns zero-valued retry statistics when no payout
records exist for the supplied settlement ID; it does not independently verify
that the settlement record exists.

## 17. List Pending Retries

`GET /settlement/payouts/pending-retries`

No authentication guard is currently attached.

### Success: `200 OK`

```json
{
  "success": true,
  "count": 1,
  "pendingRetries": [
    {
      "id": "payout-attempt-123",
      "payoutReference": "TXN-001-SUPPLIER-...",
      "settlementId": "clxsettlement123",
      "status": "RETRYING",
      "attemptCount": 2,
      "nextRetryAt": "2026-09-10T10:02:00.000Z",
      "failureReason": "Gateway timeout"
    }
  ],
  "timestamp": "2026-09-10T10:00:00.000Z"
}
```

## 18. Manually Retry Settlement Payouts

`POST /settlement/payouts/manual-retry/:settlementId`

No authentication guard is currently attached. The body is ignored.

### Success: `200 OK`

```json
{
  "success": true,
  "settlementId": "clxsettlement123",
  "retryResult": {
    "message": "Manually retried 1 failed payouts",
    "count": 1,
    "results": [
      {
        "payoutReference": "TXN-001-SUPPLIER-...",
        "status": "SUBMITTED",
        "success": true
      }
    ]
  },
  "timestamp": "2026-09-10T10:00:00.000Z"
}
```

If there are no `FAILED` or `RETRYING` payouts:

```json
{
  "success": true,
  "message": "No failed payouts to retry",
  "count": 0
}
```

### Errors

- `404 SETTLEMENT_NOT_FOUND`: settlement does not exist.

## Payout Idempotency And Retry Semantics

Payout idempotency is generated from:

```text
SHA256(settlementId + "::" + party + "::" + recipientMerchantId)
```

This means one payout attempt exists per settlement, party, and recipient
merchant. Repeating the dispatch call does not create a second completed payout.
A completed duplicate returns `isDuplicate: true` and the original payout
reference.

Default retry policy:

- Maximum retries: `5`
- Initial delay: `60` seconds
- Backoff multiplier: `2`
- Maximum delay: `3600` seconds
- Jitter: approximately plus or minus 10 percent
- Retry scheduler batch size: `10`
- Scheduler interval: `30` seconds

Payout attempt statuses:

| Status | Meaning |
| --- | --- |
| `PENDING` | Attempt record exists but gateway submission has not completed. |
| `SUBMITTED` | Gateway accepted the payout request. This does not necessarily mean funds arrived. |
| `COMPLETED` | Successful callback was received or the attempt was marked complete. |
| `FAILED` | Payout failed permanently or is not currently retryable. |
| `RETRYING` | Payout is scheduled or being prepared for another attempt. |

# Tricky Fields And Integration Guidance

## `merchantTransactionReference` Versus `reference`

`merchantTransactionReference` is the caller's original business reference. Use
it to safely retry the initiation request. The API generates a PayAssure
`reference` such as `PASTL-...` and an internal merchant transaction reference
for persistence and callbacks.

Do not replace the caller reference with the generated PayAssure reference in
client-side idempotency logic.

## Customer Payment Versus Payout Destination

The initiation request's `paymentMethod` describes how the customer pays
PayAssure. For MPESA, `payerPhoneNumber` is the customer's phone used for STK
Push.

Supplier and retailer payout destinations are loaded separately from their
verified onboarding payment records. Do not use the customer's
`payerPhoneNumber` as a supplier or retailer payout destination.

## Supplier Totals

Use either supplier-level totals:

```json
{
  "supplierMerchantId": "pay_supplier_001",
  "supplierTotalAmount": 15000,
  "retailerTotalAmount": 1200,
  "platformFee": 300
}
```

Or provide item allocations and let the service sum `supplierAmount`:

```json
{
  "supplierMerchantId": "pay_supplier_001",
  "items": [
    { "itemId": "ITEM-001", "supplierAmount": 9000 },
    { "itemId": "ITEM-002", "supplierAmount": 6000 }
  ],
  "retailerTotalAmount": 1200,
  "platformFee": 300
}
```

When both item values and supplier totals are present, they must agree. Duplicate
supplier groups are aggregated by `supplierMerchantId`.

## `MPESA` Versus `BANK` Payouts

- `MPESA` uses B2C and needs a verified phone number.
- `BANK` uses B2B and needs a verified `shortcode` and `accountName`.
- The initiating customer's MPESA payment type does not force the recipient's
  payout type. Recipient onboarding configuration wins.

## Callback Identifiers

The payout request generates a callback identifier and places it into the
callback URL and payout metadata. Keep the identifier unchanged. The callback
route with `:callbackIdentifier` is the most reliable lookup path.

## Callback Statuses

For payout callbacks, only `SUCCESS` and `PAID` are treated as successful. A
provider `PROCESSING` or unknown status is stored as a failed payout result by
the current callback service. For M-Pesa nested results, `ResultCode === 0` is
translated to `SUCCESS`.

## Amount Units And Rounding

Settlement amounts are numeric currency values. Payout dispatch rounds amounts
to the nearest whole number and forces values between `0` and `1` to `1`. Avoid
fractional smallest-unit values unless the gateway contract explicitly supports
them.

## Sensitive Data

Do not log or expose:

- User JWTs
- Settlement or supplier session tokens
- API secrets
- Internal gateway tokens
- HMAC signature secrets
- Payment provider credentials

The controller currently logs some request payloads and error context. Review
production logging and route protection before exposing unauthenticated callback,
payout, scenario, or retry routes publicly.

## Source Of Truth

- Main routes: `src/settlement/settlement.controller.ts`
- Supplier routes: `src/settlement/supplier.controller.ts`
- Settlement workflow: `src/settlement/settlement.service.ts`
- Initiation/session validation: `src/settlement/operations/initiate.operation.ts`, `src/settlement/helpers/session.helpers.ts`, and `src/settlement/helpers/validation.helpers.ts`
- Request DTOs: `src/settlement/dto/`
- M-Pesa callback transformation: `src/settlement/pipes/mpesa-callback-transform.pipe.ts`
- Payout idempotency and retry: `src/settlement/services/`
- Database status and payout models: `prisma/schema.prisma`
