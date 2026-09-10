# Settlement Confirmation Endpoint

## Overview

The settlement confirmation endpoint accepts payment confirmation events from the payment gateway and verifies them before advancing the settlement into processing.

Endpoint:
- POST /settlement/payment-confirmation

## Request format

### Body

The request body should include the confirmation payload with at least:

- settlementId: identifier of the settlement
- paymentId: provider payment identifier
- status: expected value is PAID
- provider: payment provider, typically MPESA
- paidAmount: amount paid
- paidAt: timestamp of the payment
- providerReference: object with provider references such as checkoutRequestId, merchantRequestId, and receiptNumber

### Headers

The endpoint expects these headers:

- Authorization: must be a Bearer token
- X-PayAssure-Signature: HMAC-SHA256 signature
- X-PayAssure-Timestamp: Unix timestamp in seconds

The controller also accepts case-insensitive variants for these headers:

- authorization / Authorization
- x-payassure-signature / X-PayAssure-Signature
- x-payassure-timestamp / X-PayAssure-Timestamp

## Authentication rules

### Exact encoding and comparison behavior

The implementation does not decode the bearer token or the signature. It reads them as plain strings and compares them exactly.

- The bearer token is expected in the Authorization header as:
  - `Authorization: Bearer <token>`
- The token is compared literally to the configured token value with the `Bearer ` prefix included.
- The signature is expected in the `X-PayAssure-Signature` header as a plain string.
- The signature is compared literally to the hex digest produced by HMAC-SHA256 over the exact JSON string of the request body.
- No base64 decoding, JWT parsing, or extra normalization is performed.

### 1. Bearer token validation

The bearer token must be present and must exactly match the configured expected token.

Token precedence:
1. PAYMENT_GATEWAY_API_TOKEN
2. SETTLEMENT_API_TOKEN
3. INTERNAL_GATEWAY_TOKEN

If the header is missing, malformed, or does not match the configured token, the request is rejected with 401 Unauthorized.

### 2. Signature validation

The signature is calculated as an HMAC-SHA256 digest over the exact JSON request body string, using the configured signature secret as the key.

The exact process is:

1. Resolve the signature secret using environment variable precedence:
   - `PAYMENT_GATEWAY_SIGNATURE_SECRET`
   - `SETTLEMENT_SIGNATURE_SECRET`
   - `PAYASSURE_INTERNAL_SECRET`
2. Serialize the request body with `JSON.stringify(body)` exactly as sent.
3. Compute the HMAC with SHA-256 using the resolved secret as key:
   - `crypto.createHmac('sha256', secret).update(bodyString).digest('hex')`
4. Compare the resulting hex string exactly to the value sent in the `X-PayAssure-Signature` header.

This means the sender and receiver must share the same secret and must serialize the body identically before signing. The body content is part of the signature computation, not ignored.

If the computed signature and the header value do not match, the request is rejected with 401 Unauthorized.

### Example full payload used for signature generation

The following is a complete example of the request body that should be signed:

```json
{
  "settlementId": "TXN-20260703-00000001",
  "paymentId": "pay_001",
  "status": "PAID",
  "provider": "MPESA",
  "paidAmount": 2,
  "paidAt": "2026-08-08T14:47:46.000Z",
  "providerReference": {
    "checkoutRequestId": "ws_CO_123456789",
    "merchantRequestId": "MERCHANT_123456789",
    "receiptNumber": "RCP-001"
  }
}
```

The signature is computed over the exact serialized string produced by `JSON.stringify(body)` using the configured secret as the HMAC key. When logging the expected signature, the log should include the full body string and all signing inputs used to produce it. For example:

```text
[Nest] 14811  - 08/08/2026, 2:47:46 PM     LOG [SettlementController] [CONFIRMATION][AUTH] computed signature=847880998a1b5e701bf6c6eb9f897c4491a717a5dfb925275934bdf47edcd0af expectedToken=payssure_api_token_for_settlement expectedSecret=configured body={"settlementId":"TXN-20260703-00000001","paymentId":"pay_001","status":"PAID","provider":"MPESA","paidAmount":2,"paidAt":"2026-08-08T14:47:46.000Z","providerReference":{"checkoutRequestId":"ws_CO_123456789","merchantRequestId":"MERCHANT_123456789","receiptNumber":"RCP-001"}} algorithm=HMAC-SHA256 timestamp=1786189666 token=Bearer payssure_api_token_for_settlement
```

### 3. Timestamp validation

The timestamp header must be present and must be a valid numeric Unix timestamp.

The endpoint accepts timestamps only if they are within 5 minutes of the current server time.

Rules:
- missing timestamp => rejected
- invalid timestamp => rejected
- stale timestamp => rejected
- too-far-in-future timestamp => rejected

## Success behavior

If the bearer token, signature, and timestamp are all valid, the endpoint logs a successful authentication event and forwards the confirmation to the settlement service.

## Failure behavior

The endpoint returns 401 Unauthorized for:

- missing bearer token
- invalid bearer token
- missing signature headers
- invalid signature
- stale or invalid timestamp

The service layer may also return 400 Bad Request for unsupported confirmation statuses.

## Practical example

A request is expected to look like this on the wire:

```http
POST /settlement/payment-confirmation
Content-Type: application/json
Authorization: Bearer payssure_api_token_for_settlement
X-PayAssure-Signature: <64-character-hex-hmac>
X-PayAssure-Timestamp: 1784962913
```

The body must be sent as JSON, and the signature is generated from the exact serialized body string plus the shared secret. The payload content therefore directly participates in the signature computation.

## Implementation notes

The token and signature secret resolution logic is centralized in:

- src/settlement/helpers/settlement-confirmation-credentials.ts

This keeps the incoming verification logic and any outgoing confirmation sender aligned with the same environment variable precedence.

## Example settlement initiation payload with totalAmount = 2

A sample payload for initiating a settlement request with a total amount of `2` KES:

```json
{
  "merchantId": "pay_d68f568ddc7d7b2a",
  "merchantTransactionReference": "TXN-20260703-v0s000001",
  "totalAmount": 12.5,
  "currency": "KES",
  "settlementMethod": "BANK_TRANSFER",
  "description": "Daily settlement batch",
  "paymentMethod": {
    "type": "MPESA",
    "payerPhoneNumber": "254791614036",
    "provider": "Safaricom"
  },
  "callbackUrl": "http://localhost:3000/settlement/internal/settlements/payment-confirmation",
  "transactionDate": "2026-07-03T17:30:15+03:00",
  "metadata": {
    "branchId": "BR-01",
    "terminalId": "POS-03"
  },
  "suppliers": [
    {
      "supplierMerchantId": "pay_d68f568ddc7d7b2a",
      "supplierTotalAmount": 1,
      "retailerTotalAmount": 11,
      "platformFee": 0.5
    }
  ]
}
```
