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

The signature is calculated as an HMAC-SHA256 over the configured secret alone.

The exact process is:

1. Take the configured signature secret.
2. Compute `HMAC-SHA256(secret, '')`.
3. Convert the digest to hexadecimal.
4. Compare the resulting hex string to the value sent in `X-PayAssure-Signature`.

This means the sender and receiver only need to share the same secret. The body content is not part of the signature computation.

Signature secret precedence:
1. PAYMENT_GATEWAY_SIGNATURE_SECRET
2. SETTLEMENT_SIGNATURE_SECRET
3. PAYASSURE_INTERNAL_SECRET

The provided signature header must exactly match the computed signature. If it does not, the request is rejected with 401 Unauthorized.

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

The body must be sent as JSON, but the signature is generated from the secret alone and does not depend on the payload content.

## Implementation notes

The token and signature secret resolution logic is centralized in:

- src/settlement/helpers/settlement-confirmation-credentials.ts

This keeps the incoming verification logic and any outgoing confirmation sender aligned with the same environment variable precedence.
