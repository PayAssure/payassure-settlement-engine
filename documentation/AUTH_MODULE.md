# Authentication API

This document describes every endpoint exposed by `src/auth/auth.controller.ts`.
The route prefix is `/auth`.

## Authentication Model

There are two related credential types in the platform:

- **User credentials**: username or email plus password. A successful login returns a JWT access token and a JWT refresh token.
- **Business API credentials**: API key and API secret used by settlement integrations. Business authentication is documented separately in `documentation/SETTLEMENT_MODULE_DESIGN.md`; it is not an `/auth` route.

Protected `/auth` routes require:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

The access token is signed with `JWT_SECRET` or the development fallback `payassure-dev-secret` and expires after 15 minutes. Refresh tokens expire after 7 days. The server checks `refreshTokenVersion` on every protected request, so logging out or rotating a refresh token invalidates the previous token version.

## User Roles

- `SUPER_ADMIN`: may create administrators, list all users, and delete any user.
- `ADMIN`: administrator account, but not a `SUPER_ADMIN`.
- `USER`: standard participant account.

## Common Error Responses

NestJS exceptions use this general shape:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

Validation failures are formatted by the global validation filter and include the request path:

```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "password must be longer than or equal to 6 characters"
  ],
  "error": "Bad Request",
  "path": "/auth/register-before-onboarding"
}
```

Request validation rules:

- `username`: string.
- `email`: valid email address.
- `password`: string with at least 6 characters for registration; login only requires a string.
- `identifier`: string containing either the user's username or email.
- `refreshToken`: string.
- Unknown request-body properties are removed because the application uses a whitelist validation pipe.

## Endpoints

### 1. Register an administrator

`POST /auth/register`

Creates an `ADMIN` account. The caller must be authenticated and must have the `SUPER_ADMIN` role.

#### Headers

```http
Authorization: Bearer <super_admin_access_token>
Content-Type: application/json
```

#### Request body

```json
{
  "username": "operations-admin",
  "email": "admin@example.com",
  "password": "strong-password"
}
```

#### Success: `201 Created`

```json
{
  "message": "User account created successfully",
  "profileComplete": true,
  "user": {
    "id": "clx123user",
    "username": "operations-admin",
    "email": "admin@example.com",
    "role": "ADMIN"
  }
}
```

#### Errors

- `400 Bad Request`: body validation failed.
- `401 Unauthorized`: bearer token is missing, malformed, expired, revoked, or otherwise invalid.
- `403 Forbidden`: authenticated user is not a `SUPER_ADMIN`; message: `Only a super admin can create another admin`.
- `409 Conflict`: email or username already exists. The message is either `Email already exists` or `Username already exists`.

### 2. Register before onboarding

`POST /auth/register-before-onboarding`

Creates a standard `USER` account before the participant has completed onboarding. The account is active, but the returned profile is incomplete. No bearer token is required.

#### Request body

```json
{
  "username": "merchant-user",
  "email": "merchant@example.com",
  "password": "strong-password"
}
```

#### Success: `201 Created`

```json
{
  "message": "Account created successfully. Your profile is incomplete. Please complete onboarding to finish setup.",
  "profileComplete": false,
  "user": {
    "id": "clx123user",
    "username": "merchant-user",
    "email": "merchant@example.com",
    "role": "USER"
  }
}
```

If the email already belongs to an onboarding participant and an account already exists, the endpoint links the participant to that account and returns `201` with this shape instead of failing:

```json
{
  "message": "Account already exists. Please complete onboarding to finish your profile.",
  "profileComplete": false,
  "user": {
    "id": "clx123user",
    "username": "merchant-user",
    "email": "merchant@example.com",
    "role": "USER"
  }
}
```

#### Errors

- `400 Bad Request`: body validation failed.
- `409 Conflict`: `Email already exists` or `Username already exists`.

### 3. Register after onboarding

`POST /auth/onboarded-register`

Creates a standard `USER` account for an existing onboarding participant, or links an existing account to that participant. An onboarding record must be found by the submitted email. No bearer token is required.

#### Request body

```json
{
  "username": "merchant-user",
  "email": "merchant@example.com",
  "password": "strong-password"
}
```

#### Success: `201 Created`

For a new account:

```json
{
  "message": "User account created successfully and profile is complete.",
  "profileComplete": true,
  "user": {
    "id": "clx123user",
    "username": "merchant-user",
    "email": "merchant@example.com",
    "role": "USER"
  }
}
```

For an existing account linked to onboarding:

```json
{
  "message": "Your profile is now complete.",
  "profileComplete": true,
  "user": {
    "id": "clx123user",
    "username": "merchant-user",
    "email": "merchant@example.com",
    "role": "USER"
  }
}
```

#### Errors

- `400 Bad Request`: body validation failed.
- `401 Unauthorized`: no onboarding record exists for the submitted email; message: `No onboarding record found for this email address`.
- `409 Conflict`: email or username already exists in a conflicting account; message: `Email already exists` or `Username already exists`.

### 4. Login

`POST /auth/login`

Authenticates an active user using either the username or email address. No bearer token is required.

#### Request body

```json
{
  "identifier": "merchant-user",
  "password": "strong-password"
}
```

`identifier` may instead be an email address.

#### Success: `201 Created`

```json
{
  "accessToken": "<jwt-access-token>",
  "refreshToken": "<jwt-refresh-token>",
  "profileComplete": true,
  "message": "Profile complete.",
  "user": {
    "id": "clx123user",
    "username": "merchant-user",
    "email": "merchant@example.com",
    "role": "USER"
  }
}
```

When onboarding is incomplete, `profileComplete` is `false` and `message` is `Your profile is incomplete. Please finish onboarding to get API keys access.`

#### Errors

- `400 Bad Request`: `identifier` or `password` is missing or is not a string.
- `401 Unauthorized`: user does not exist, is inactive, or the password is incorrect; message: `Invalid credentials`.

### 5. Request a password reset

`POST /auth/forgot-password`

Requests a password reset email for an active account. No bearer token is
required.

#### Request body

```json
{
  "email": "merchant@example.com"
}
```

#### Success: `201 Created`

The endpoint intentionally returns the same response whether or not the email
belongs to an account, preventing account-enumeration through this route:

```json
{
  "message": "If an account exists for that email, a password reset OTP has been sent."
}
```

For an active user, the server generates a cryptographically random token,
stores only its SHA-256 hash, and sends the six-digit OTP through the configured
SMTP email service. The OTP expires after one hour. A new request invalidates
any previous reset OTP for that user.

#### Errors

- `400 Bad Request`: email is missing or is not a valid email address.
- `500 Internal Server Error`: the email service is unavailable or the reset
  email could not be sent. The token is removed when delivery fails.

The email contains the six-digit OTP. The OTP is not returned in the HTTP
response and is never stored in plaintext in the database.

### 6. Reset a password

`POST /auth/reset-password`

Consumes the six-digit OTP received by email and sets a new password. No bearer
token is required.

#### Request body

```json
{
  "otp": "482913",
  "newPassword": "new-strong-password"
}
```

#### Success: `201 Created`

```json
{
  "message": "Password reset successfully. Please log in with your new password."
}
```

The OTP is single-use. After a successful reset, all existing refresh tokens
are invalidated by incrementing the user's `refreshTokenVersion`; the user must
log in again to obtain a new access/refresh-token pair.

#### Errors

- `400 Bad Request`: OTP is missing, is not a string of exactly six digits, or
  `newPassword` is shorter than 6 characters.
- `401 Unauthorized`: OTP is invalid, expired, already used, or belongs to an
  inactive account; message: `Invalid or expired password reset OTP`.

### Password reset email configuration

Password reset delivery uses the same SMTP settings as onboarding emails:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=mailer@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=PayAssure <mailer@example.com>
SMTP_SECURE=false
```

The reset OTP should be treated like a credential. Do not log it or include it
in analytics. Never store it in plaintext.

### 7. Refresh tokens

`POST /auth/refresh`

Exchanges a valid refresh token for a new access-token and refresh-token pair. The refresh token is rotated: the previous token version is invalid after a successful refresh. No bearer token is required.

#### Request body

```json
{
  "refreshToken": "<jwt-refresh-token>"
}
```

#### Success: `201 Created`

The response has the same shape as login:

```json
{
  "accessToken": "<new-jwt-access-token>",
  "refreshToken": "<new-jwt-refresh-token>",
  "profileComplete": true,
  "message": "Profile complete.",
  "user": {
    "id": "clx123user",
    "username": "merchant-user",
    "email": "merchant@example.com",
    "role": "USER"
  }
}
```

#### Errors

- `400 Bad Request`: `refreshToken` is missing or is not a string.
- `401 Unauthorized`: token is missing, malformed, expired, signed with the wrong secret, belongs to a missing/inactive user, or has an old token version; message: `Invalid refresh token`.

### 8. Logout

`POST /auth/logout`

Invalidates the current user's refresh-token version. Existing access tokens remain subject to normal JWT expiry, but refresh attempts using the old token version fail.

#### Headers

```http
Authorization: Bearer <access_token>
```

#### Request body

None.

#### Success: `200 OK`

```json
{
  "message": "Logged out successfully"
}
```

#### Errors

- `401 Unauthorized`: bearer token is missing, expired, revoked, or invalid.

### 9. List users

`GET /auth/users`

Returns users for administration. Only a `SUPER_ADMIN` may access this endpoint.

#### Headers

```http
Authorization: Bearer <super_admin_access_token>
```

#### Query parameters

All parameters are optional:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `role` | `SUPER_ADMIN \| ADMIN \| USER` | none | Exact role filter. |
| `isActive` | boolean | none | Filter by active status. |
| `search` | string | none | Case-insensitive partial match on username or email. |
| `skip` | integer, minimum 0 | `0` | Number of records to skip. |
| `take` | integer, minimum 1 | `10` | Number of records to return. |
| `sortBy` | `username \| email \| role \| createdAt \| updatedAt` | `createdAt` | Sort field. |
| `sortOrder` | `asc \| desc` | `desc` | Sort direction. |

Example:

`GET /auth/users?role=USER&isActive=true&search=merchant&skip=0&take=10&sortBy=createdAt&sortOrder=desc`

#### Success: `200 OK`

```json
{
  "data": [
    {
      "id": "clx123user",
      "username": "merchant-user",
      "email": "merchant@example.com",
      "role": "USER",
      "isActive": true,
      "createdAt": "2026-09-10T08:30:00.000Z",
      "updatedAt": "2026-09-10T08:30:00.000Z"
    }
  ],
  "total": 1,
  "skip": 0,
  "take": 10,
  "hasMore": false
}
```

#### Errors

- `400 Bad Request`: enum, boolean, integer, minimum, or sort value is invalid.
- `401 Unauthorized`: bearer token is missing, expired, revoked, or invalid.
- `403 Forbidden`: authenticated user is not a `SUPER_ADMIN`; message: `Only super admins can view all users`.

### 10. Delete a user

`DELETE /auth/:id`

Deletes a user account. A user may delete their own account. A `SUPER_ADMIN` may delete any account. Other users may not delete another account.

#### Path parameter

- `id`: target user ID.

#### Headers

```http
Authorization: Bearer <access_token>
```

#### Request body

None.

#### Success: `200 OK`

```json
{
  "message": "User deleted successfully"
}
```

#### Errors

- `401 Unauthorized`: bearer token is missing, expired, revoked, or invalid.
- `401 Unauthorized`: target user does not exist; the current service message is `User not found`.
- `403 Forbidden`: authenticated user is deleting another user without the `SUPER_ADMIN` role; message: `Only a super admin can delete another user`.

## Token and Authorization Details

### JWT claims

Tokens contain these claims:

```json
{
  "sub": "clx123user",
  "username": "merchant-user",
  "email": "merchant@example.com",
  "role": "USER",
  "version": 0
}
```

Clients should treat access and refresh tokens as opaque strings and should not construct or modify JWT claims themselves.

### Token invalidation

- `POST /auth/refresh` increments `refreshTokenVersion` and returns a new pair.
- `POST /auth/logout` increments `refreshTokenVersion` without issuing a new pair.
- The JWT strategy also rejects tokens when the user is inactive or the token's version no longer matches the database.

### Security notes

- Passwords are stored as bcrypt hashes and are never returned by these endpoints.
- Login intentionally returns the same `Invalid credentials` message for a missing user, inactive user, or incorrect password.
- Store refresh tokens securely and send them only to `/auth/refresh`.
- Do not log or expose access tokens, refresh tokens, password values, or API secrets in client-visible diagnostics.

## Related Business Authentication

The following route authenticates a business integration rather than a platform
user. It is implemented by `SettlementController`, so its path is outside the
`/auth` controller, but it is part of the platform's authentication flows.

### Authenticate a business integration

`POST /settlement/authenticate`

Verifies a business API key and API secret and creates a settlement session.
Unlike the older settlement design document, the current controller protects
this endpoint with a platform JWT. Send both credentials below and a valid user
access token whose email matches the onboarding participant owning the API key.

#### Headers

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

#### Request body

```json
{
  "apiKey": "pk_live_abc123",
  "apiSecret": "sk_live_xyz789"
}
```

#### Success: `200 OK`

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

The returned settlement session token is used by settlement operations in the
`x-settlement-session` header. The exact expiry is controlled by the settlement
configuration; the documented default is 3600 seconds.

#### Errors

- `400 Bad Request`: `apiKey` or `apiSecret` is missing, empty, or not a
  string.
- `401 Unauthorized`: platform JWT is missing/invalid, the token owner does
  not own the supplied API credentials (`INVALID_TOKEN_FOR_API_KEYS`), or the
  API secret is incorrect (`INVALID_CREDENTIALS`).
- `404 Not Found`: no active integration exists for the API key
  (`BUSINESS_NOT_FOUND`).
- `403 Forbidden`: the business participant status is not `ACTIVE`
  (`BUSINESS_NOT_ACTIVE`).

Error example:

```json
{
  "statusCode": 401,
  "message": "Invalid API credentials",
  "error": "INVALID_CREDENTIALS"
}
```

## Source of Truth

- Controller and route declarations: `src/auth/auth.controller.ts`
- Authentication and authorization behavior: `src/auth/auth.service.ts`
- Request validation: `src/auth/dto/`
- JWT verification: `src/auth/jwt.strategy.ts`
- Global validation error formatting: `src/common/filters/validation-error.filter.ts`
