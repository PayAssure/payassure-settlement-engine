# Onboarding API

This document describes every route exposed by `src/onbordings/onbordings.controller.ts`.
The controller route prefix is `/onbordings` (including the existing spelling of
"onbordings" in the URL).

## Overview

The onboarding module manages participant records for retailers and suppliers,
payout destinations, integrations, API credentials, and webhook URLs.

The module exposes 12 routes:

| Method | Route | Authentication |
| --- | --- | --- |
| `POST` | `/onbordings` | Public |
| `POST` | `/onbordings/generate-keys` | JWT bearer token |
| `GET` | `/onbordings/keys` | JWT bearer token |
| `GET` | `/onbordings/integration/credentials` | JWT bearer token |
| `GET` | `/onbordings` | Public |
| `GET` | `/onbordings/me` | JWT bearer token |
| `GET` | `/onbordings/:id` | JWT bearer token |
| `PATCH` | `/onbordings/payment` | JWT bearer token |
| `PATCH` | `/onbordings/:id` | JWT bearer token |
| `DELETE` | `/onbordings/:id` | JWT bearer token |
| `PATCH` | `/onbordings/:id/webhook` | JWT bearer token |
| `PATCH` | `/onbordings/payment/activate` | JWT bearer token |

Protected routes require:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

The bearer token is the user JWT issued by `POST /auth/login` or
`POST /auth/refresh`. The JWT guard rejects missing, expired, revoked, inactive,
or otherwise invalid tokens with `401 Unauthorized`.

## Participant Types and Statuses

`participantType` must be one of:

- `RETAILER`
- `SUPPLIER`

When a participant is created or updated, the service checks these fields:
`participantType`, `businessName`, `contactName`, `email`, `phoneNumber`,
`settlementMethod`, and `settlementAccount`.

- If every field is present and non-blank, the participant status is
  `DOCUMENTS_SUBMITTED`.
- If any field is missing or blank, the participant status is `DRAFT`.

Later onboarding, payment verification, and integration workflows may update
status outside the routes described here.

## Common Validation and Error Format

The application uses a global whitelist validation pipe. Unknown request-body
properties are removed before the controller receives the body. Validation
failures are returned by the global validation filter in this shape:

```json
{
  "statusCode": 400,
  "message": [
    "participantType must be a valid enum value",
    "businessName must be a string"
  ],
  "error": "Bad Request",
  "path": "/onbordings"
}
```

For service exceptions, the normal NestJS shape is used:

```json
{
  "statusCode": 404,
  "message": "Participant not found",
  "error": "Not Found"
}
```

## Shared Payloads

### Participant fields

The creation payload accepts:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `participantType` | `RETAILER \| SUPPLIER` | Yes | Must be a valid enum value. |
| `businessName` | string | Yes | Business name. |
| `registrationNumber` | string | No | Registration identifier. |
| `kraPin` | string | No | Tax identifier. |
| `businessType` | string | No | For example, `Limited Company`. |
| `industry` | string | No | For example, `Retail`. |
| `physicalAddress` | string | No | Business address. |
| `contactName` | string | No | Contact or beneficiary name. |
| `email` | email | No | Used to link the participant to a user account. |
| `phoneNumber` | string | No | Participant contact number. |
| `settlementMethod` | string | No | For example, `BANK`. |
| `settlementAccount` | string | No | Settlement account identifier. |
| `posSystem` | string | No | For example, `Odoo`. |
| `settlementPreference` | string | No | For example, `DAILY`. |
| `payment` | object | No | Payout destination; see payment payload below. |

`PATCH /onbordings/:id` accepts the same fields as a partial payload. All fields
are optional for that route.

### Payment payload

Payment destinations support exactly two types:

```json
{
  "type": "MPESA",
  "accountName": "Jane Doe",
  "phoneNumber": "254712345678",
  "provider": "Safaricom"
}
```

```json
{
  "type": "BANK",
  "accountName": "Jane Doe",
  "bankCode": "07",
  "accountNumber": "1234567890",
  "shortcode": "123456",
  "provider": "Example Bank"
}
```

Rules enforced by DTO validation and the service:

- `type` must be `MPESA` or `BANK`.
- `accountName` is required and must be a string.
- MPESA requires `phoneNumber`. The legacy `payerPhoneNumber` alias is accepted
  and is normalized to `phoneNumber`.
- MPESA rejects `bankCode`, `accountNumber`, and `shortcode`.
- BANK requires `bankCode` and `accountNumber` and rejects `phoneNumber` and
  `payerPhoneNumber`.
- BANK `shortcode`, when provided, may contain digits only.
- `isVerified` is backend-managed and must not be supplied by clients.
- `status`, activation-secret fields, verification counters, and verification
  timestamps are backend-managed. Clients should not send them.

When a payment destination is created or replaced, the service stores it as
`PENDING_VERIFICATION`, generates a `paysec_...` activation secret, and gives the
raw secret to the caller in the response. The secret expires after 24 hours.

## Endpoints

### 1. Create an onboarding participant

`POST /onbordings`

Creates a retailer or supplier onboarding record. This route is public; no
JWT is required.

#### Request body

```json
{
  "participantType": "RETAILER",
  "businessName": "ABC Supermarket",
  "registrationNumber": "REG-1001",
  "kraPin": "A123456789Z",
  "businessType": "Limited Company",
  "industry": "Retail",
  "physicalAddress": "Nairobi, Kenya",
  "contactName": "Jane Doe",
  "email": "jane@example.com",
  "phoneNumber": "+254700000000",
  "settlementMethod": "BANK",
  "settlementAccount": "123456789",
  "posSystem": "Odoo",
  "settlementPreference": "DAILY",
  "payment": {
    "type": "BANK",
    "accountName": "Jane Doe",
    "bankCode": "07",
    "accountNumber": "1234567890",
    "shortcode": "123456",
    "provider": "Example Bank"
  }
}
```

#### Success: `201 Created`

```json
{
  "message": "Onboarding created. Please register an account to complete your profile.",
  "id": "participant-123",
  "participantType": "RETAILER",
  "businessName": "ABC Supermarket",
  "businessType": "Limited Company",
  "contactName": "Jane Doe",
  "email": "jane@example.com",
  "status": "DOCUMENTS_SUBMITTED",
  "integration": null,
  "payment": {
    "type": "BANK",
    "accountName": "Jane Doe",
    "bankCode": "07",
    "accountNumber": "1234567890",
    "shortcode": "123456",
    "provider": "Example Bank",
    "status": "PENDING_VERIFICATION",
    "isVerified": false,
    "paymentActivationSecret": "paysec_7f3c9a2b6d..."
  },
  "createdAt": "2026-09-10T08:30:00.000Z",
  "updatedAt": "2026-09-10T08:30:00.000Z"
}
```

The response message changes by state:

- If no user exists for the email: `Onboarding created. Please register an
  account to complete your profile.`
- If required profile fields are incomplete: `Your onboarding request is
  currently in draft because the profile is incomplete. Please complete the
  required details to move it forward.`
- If neither condition applies, `message` may be omitted.

If an onboarding record with the same email and participant type already exists,
the endpoint returns the existing record with `201` and this message:

`This onboarding request was not created because an onboarding record for the same participant type already exists for this user.`

#### Errors

- `400 Bad Request`: invalid enum, email, string, nested payment, or payment
  field.
- `403 Forbidden`: invalid payout destination rules, such as missing BANK
  fields, an MPESA bank field, or a supplied `isVerified` value.
- `500 Internal Server Error`: unexpected creation failure or invalid generated
  credential data.

### 2. Generate API keys

`POST /onbordings/generate-keys`

Generates credentials for the onboarding participant belonging to the email in
the authenticated JWT. No participant ID is supplied.

#### Request body

None.

#### Success: `200 OK`

For a first-time generation:

```json
{
  "message": "These are the API keys generated for the first time.",
  "id": "participant-123",
  "participantType": "RETAILER",
  "businessName": "ABC Supermarket",
  "status": "DOCUMENTS_SUBMITTED",
  "integration": {
    "id": "integration-123",
    "merchantId": "pay_4bec11e5a382fe7c",
    "apiKey": "pk_live_d093937d634dcb700b6d34ba6f29c55e",
    "apiSecret": "sk_live_85faf3a09cb5b38cb84c48b09a67da9f",
    "environment": "production",
    "isActive": true,
    "createdAt": "2026-09-10T08:30:00.000Z"
  },
  "payment": null,
  "createdAt": "2026-09-10T08:30:00.000Z",
  "updatedAt": "2026-09-10T08:30:00.000Z"
}
```

If credentials already exist, no new credentials are generated and the message
is `API keys were not generated because they already exist. Use the existing credentials.`
If the integration exists but its credentials are missing, they are regenerated
and the message is `API keys were generated and persisted because previous credentials were missing.`

#### Errors

- `401 Unauthorized`: missing or invalid JWT.
- `404 Not Found`: no onboarding participant exists for the authenticated
  user's email; message: `Onboarding participant not found for the authenticated user`.
- `500 Internal Server Error`: generated credential data fails validation; no
  partial credentials are persisted.

### 3. View the authenticated user's API keys

`GET /onbordings/keys`

Returns the latest integration credentials for the participant associated with
the authenticated user's email.

#### Request body

None.

#### Success: `200 OK`

Returns an `OnboardingResponseDto` like this:

```json
{
  "id": "participant-123",
  "participantType": "RETAILER",
  "businessName": "ABC Supermarket",
  "status": "DOCUMENTS_SUBMITTED",
  "integration": {
    "id": "integration-123",
    "merchantId": "pay_4bec11e5a382fe7c",
    "apiKey": "pk_live_d093937d634dcb700b6d34ba6f29c55e",
    "apiSecret": "sk_live_85faf3a09cb5b38cb84c48b09a67da9f",
    "environment": "production",
    "isActive": true,
    "createdAt": "2026-09-10T08:30:00.000Z"
  }
}
```

#### Errors

- `401 Unauthorized`: missing or invalid JWT.
- `404 Not Found`: participant is missing, or no integration with both API key
  and API secret exists. The latter message is `API keys not found for the authenticated user`.

### 4. Look up integration credentials by email

`GET /onbordings/integration/credentials`

Returns the latest integration for a participant email. This route requires a
JWT, but the implementation does not restrict the requested email to the
authenticated user's email.

#### Query parameters

- `email`: required email string.
- `isActive`: optional filter. The controller treats `true` or `1` as `true`;
  any other supplied value is treated as `false`.

Example:

`GET /onbordings/integration/credentials?email=merchant@example.com&isActive=true`

#### Success: `200 OK`

```json
{
  "id": "integration-123",
  "participantId": "participant-123",
  "participantEmail": "merchant@example.com",
  "merchantId": "pay_4bec11e5a382fe7c",
  "apiKey": "pk_live_d093937d634dcb700b6d34ba6f29c55e",
  "apiSecret": "sk_live_85faf3a09cb5b38cb84c48b09a67da9f",
  "environment": "production",
  "isActive": true,
  "createdAt": "2026-09-10T08:30:00.000Z"
}
```

#### Errors

- `401 Unauthorized`: missing or invalid JWT.
- `404 Not Found`: email is missing, or no matching integration exists; message:
  `Integration credentials not found for the provided email and active status`.

### 5. List onboarding participants

`GET /onbordings`

Lists participants publicly. No JWT is required.

#### Request body

None.

#### Success: `200 OK`

Returns an array of public participant records:

```json
[
  {
    "id": "participant-123",
    "participantType": "RETAILER",
    "businessName": "ABC Supermarket",
    "businessType": "Limited Company",
    "contactName": "Jane Doe",
    "email": "jane@example.com",
    "status": "DOCUMENTS_SUBMITTED",
    "integration": {
      "merchantId": "pay_4bec11e5a382fe7c",
      "apiKey": "pk_live_...",
      "apiSecret": "sk_live_...",
      "environment": "production",
      "isActive": true
    },
    "payment": {
      "type": "BANK",
      "accountName": "Jane Doe",
      "status": "VERIFIED",
      "isVerified": true,
      "provider": "Example Bank",
      "bankCode": "07",
      "accountNumber": "1234567890",
      "shortcode": "123456"
    },
    "createdAt": "2026-09-10T08:30:00.000Z",
    "updatedAt": "2026-09-10T08:30:00.000Z"
  }
]
```

The public payment response omits activation-secret hashes, expiry timestamps,
verification attempts, verification method, and verification timestamp. The
current implementation still includes `apiKey` and `apiSecret` in the public
integration object. Treat this as sensitive behavior when deploying the API.

#### Errors

No controller-level errors are declared for this route. An unexpected database
failure may result in `500 Internal Server Error`.

### 6. Get the authenticated user's participant

`GET /onbordings/me`

Looks up the participant using the email claim in the JWT.

#### Request body

None.

#### Success: `200 OK`

Returns an `OnboardingResponseDto` with the participant, latest integration,
and safe payment information.

#### Errors

- `401 Unauthorized`: missing or invalid JWT, or the authenticated token has no
  email claim; message: `Authenticated user email is required`.
- `404 Not Found`: no participant matches the authenticated user's email;
  message: `Onboarding participant not found for the authenticated user`.

### 7. Get a participant by ID

`GET /onbordings/:id`

Returns a participant and its latest integration. The route requires a JWT but
the service does not apply an owner or role check to the requested ID.

#### Path parameter

- `id`: participant ID string.

#### Request body

None.

#### Success: `200 OK`

```json
{
  "id": "participant-123",
  "participantType": "SUPPLIER",
  "businessName": "Supplier Ltd",
  "businessType": "Limited Company",
  "contactName": "John Doe",
  "email": "supplier@example.com",
  "status": "DRAFT",
  "integration": null,
  "payment": null,
  "createdAt": "2026-09-10T08:30:00.000Z",
  "updatedAt": "2026-09-10T08:30:00.000Z"
}
```

#### Errors

- `401 Unauthorized`: missing or invalid JWT.
- `404 Not Found`: participant does not exist; message: `Participant not found`.

### 8. Update the authenticated user's payment destination

`PATCH /onbordings/payment`

Updates the payout destination for the participant associated with the JWT email.
This route does not accept a participant ID.

#### Request body

The payment object is wrapped inside `payment`:

```json
{
  "payment": {
    "type": "MPESA",
    "accountName": "Jane Doe",
    "phoneNumber": "254712345678",
    "provider": "Safaricom"
  }
}
```

#### Success: `200 OK`

Returns an `OnboardingResponseDto`. The payment is stored as
`PENDING_VERIFICATION` and the response includes a new
`paymentActivationSecret`:

```json
{
  "id": "participant-123",
  "participantType": "RETAILER",
  "businessName": "ABC Supermarket",
  "status": "DOCUMENTS_SUBMITTED",
  "payment": {
    "type": "MPESA",
    "accountName": "Jane Doe",
    "phoneNumber": "254712345678",
    "provider": "Safaricom",
    "status": "PENDING_VERIFICATION",
    "isVerified": false,
    "paymentActivationSecret": "paysec_7f3c9a2b6d..."
  }
}
```

#### Errors

- `400 Bad Request`: wrapper or nested payment validation failed.
- `401 Unauthorized`: missing or invalid JWT.
- `403 Forbidden`: payment type or destination rules failed; examples include
  `Payment type must be MPESA or BANK`, `accountName is required`,
  `phoneNumber is required for MPESA payout destinations`, or
  `bankCode and accountNumber are required for BANK payout destinations`.
- `404 Not Found`: authenticated user has no participant;
  `Onboarding participant not found for the authenticated user`.

### 9. Update a participant

`PATCH /onbordings/:id`

Partially updates a participant. The route requires a JWT, but the service does
not enforce ownership or role-based authorization for the target ID.

#### Request body

Any subset of the participant fields may be sent:

```json
{
  "businessName": "ABC Supermarket Limited",
  "contactName": "Jane Doe",
  "phoneNumber": "+254700000000",
  "settlementMethod": "BANK",
  "settlementAccount": "123456789"
}
```

A nested `payment` object may also be supplied using the shared payment rules.

#### Success: `200 OK`

Returns the updated `OnboardingResponseDto`. The participant status is recalculated
to `DRAFT` or `DOCUMENTS_SUBMITTED` from the resulting profile fields.

#### Errors

- `400 Bad Request`: invalid participant or nested payment fields.
- `401 Unauthorized`: missing or invalid JWT.
- `403 Forbidden`: invalid payout destination rules.
- `404 Not Found`: participant does not exist; message: `Participant not found`.

### 10. Delete a participant

`DELETE /onbordings/:id`

Deletes the participant record. The controller requires a JWT, but the current
service does not enforce ownership or role-based authorization. Associated data
is subject to the database relationship delete behavior.

#### Request body

None.

#### Success: `200 OK`

```json
{
  "message": "Participant deleted successfully"
}
```

#### Errors

- `401 Unauthorized`: missing or invalid JWT.
- `404 Not Found`: participant does not exist; message: `Participant not found`.

### 11. Update a participant webhook URL

`PATCH /onbordings/:id/webhook`

Updates the participant's webhook URL.

#### Path parameter

- `id`: participant ID string.

#### Request body

```json
{
  "webhookUrl": "https://merchant.example.com/payassure/webhook"
}
```

`webhookUrl` must be a valid URL.

#### Success: `200 OK`

Returns the updated `OnboardingResponseDto`.

#### Errors

- `400 Bad Request`: `webhookUrl` is missing or is not a valid URL.
- `401 Unauthorized`: missing or invalid JWT.
- `404 Not Found`: participant does not exist; message: `Participant not found`.

### 12. Activate the authenticated user's payment destination

`PATCH /onbordings/payment/activate`

Verifies the pending payout destination using the activation secret generated
when the payment destination was created or replaced. The participant is found
from the authenticated JWT email; no participant ID is supplied.

#### Request body

```json
{
  "paymentActivationSecret": "paysec_7f3c9a2b6d..."
}
```

#### Success: `200 OK`

```json
{
  "id": "participant-123",
  "participantType": "RETAILER",
  "businessName": "ABC Supermarket",
  "status": "DOCUMENTS_SUBMITTED",
  "payment": {
    "type": "MPESA",
    "accountName": "Jane Doe",
    "phoneNumber": "254712345678",
    "provider": "Safaricom",
    "status": "VERIFIED",
    "isVerified": true,
    "verificationAttempts": 0,
    "verificationMethod": "PAYMENT_ACTIVATION_SECRET",
    "verifiedAt": "2026-09-10T09:00:00.000Z"
  }
}
```

The response strips the stored activation-secret hash and expiry timestamp.

#### Errors

- `400 Bad Request`: activation secret is missing or is not a string.
- `401 Unauthorized`: missing or invalid JWT, or the token has no email claim;
  message: `Authenticated user email is required`.
- `403 Forbidden`: participant payment is not configured, is not pending
  verification, has no available secret, the secret has expired, or the secret
  is incorrect. Relevant messages include `Participant payment destination is
  not configured`, `Participant payment destination is not pending verification`,
  `Payment activation secret is not available`, `Payment activation secret has
  expired`, and `Invalid payment activation secret`.
- `404 Not Found`: no participant matches the authenticated user's email;
  message: `Onboarding participant not found for the authenticated user`.

## Response Shapes

### Authenticated onboarding response

Most protected participant routes return this shape:

```json
{
  "message": "optional operation message",
  "id": "participant-123",
  "participantType": "RETAILER",
  "businessName": "ABC Supermarket",
  "businessType": "Limited Company",
  "contactName": "Jane Doe",
  "email": "jane@example.com",
  "status": "DRAFT",
  "integration": {
    "id": "integration-123",
    "merchantId": "pay_...",
    "apiKey": "pk_live_...",
    "apiSecret": "sk_live_...",
    "environment": "production",
    "isActive": true,
    "createdAt": "2026-09-10T08:30:00.000Z"
  },
  "payment": {
    "type": "BANK",
    "accountName": "Jane Doe",
    "bankCode": "07",
    "accountNumber": "1234567890",
    "status": "PENDING_VERIFICATION",
    "isVerified": false
  },
  "createdAt": "2026-09-10T08:30:00.000Z",
  "updatedAt": "2026-09-10T08:30:00.000Z"
}
```

Stored payment security fields such as `paymentActivationSecretHash`,
`paymentActivationSecretExpiresAt`, `verificationAttempts`,
`verificationMethod`, and `verifiedAt` are removed by the normal response
formatter, except that `verificationAttempts`, `verificationMethod`, and
`verifiedAt` may appear after successful payment activation because that route
returns the repository entity directly through the formatter.

### Public onboarding response

`GET /onbordings` returns a reduced participant shape without integration IDs,
participant integration timestamps, or payment secret metadata. It does still
return the current implementation's `apiKey` and `apiSecret` values.

## Security Considerations

- API secrets are returned by API-key generation, API-key viewing, credential
  lookup, authenticated participant responses, and the public participant list.
  Protect these routes and consider removing secrets from public responses before
  production exposure.
- Payment activation secrets are returned in create/update payment responses.
  Deliver them only to the intended account owner and do not log them.
- The credential lookup route accepts any email from an authenticated caller.
- Participant lookup, update, and deletion by ID require a JWT but currently do
  not enforce ownership or administrator authorization.

## Source of Truth

- Routes and guards: `src/onbordings/onbordings.controller.ts`
- Business behavior and response mapping: `src/onbordings/onbordings.service.ts`
- Database operations and status calculation: `src/onbordings/onbordings.repository.ts`
- Request DTOs: `src/onbordings/dto/`
- Global validation formatting: `src/common/filters/validation-error.filter.ts`
