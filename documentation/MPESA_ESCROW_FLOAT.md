# Retailer M-Pesa Escrow Float

This document describes the retailer float configuration API and the live CASH settlement flow that protects PayAssure from unauthorized retailer withdrawals or unexpected balance changes.

## 1. Concept

Each retailer has one tracked escrow float in KES:

- `dailyFloat`: the configured starting float or operating limit. Updating this value does not automatically change the tracked remainder.
- `expectedRemainingBalance`: the balance that PayAssure expects to remain in the retailer's M-Pesa working account before the next settlement. It is reduced only after a successful escrow B2B callback.
- `activeTransferId`: an internal lock identifying the settlement currently using the float. Only one escrow transfer may be active for a retailer at a time.

The float is a control and verification mechanism, not a ledger of Safaricom's actual balance. Before each CASH settlement, Safaricom's Account Balance response is compared with `expectedRemainingBalance`. After PayAssure receives the CASH amount, the expected remainder is reduced by that CASH amount.

Example:

```text
Configured remainder:       10,000 KES
Settlement CASH amount:       2,000 KES
Required observed balance:   at least 10,000 KES
New remainder after success:  8,000 KES
```

The new remainder is calculated as `max(0, oldExpectedRemainingBalance - cashAmount)`.

## 2. Float configuration endpoints

The retailer uses the normal bearer JWT returned by `POST /auth/login` to view its float and initiate deposits. The application resolves the retailer merchant ID from the authenticated user's active retailer integration. Only an `ADMIN` or `SUPER_ADMIN` can create or edit the float configuration.

### 2.1 Read the current float

```http
GET /escrow/retailer/float
Authorization: Bearer <retailer-jwt>
```

Successful response:

```json
{
  "merchantId": "pay_retailer_001",
  "currency": "KES",
  "dailyFloat": 10000,
  "expectedRemainingBalance": 8000,
  "tillNumber": "TILL-001",
  "storeNumber": "STORE-001",
  "updatedAt": "2026-09-28T19:30:00.000Z"
}
```

`currency` is currently always `KES`; it is not accepted as a request field.

### 2.2 Create or update the float

```http
PUT /escrow/retailers/{merchantId}/float
Authorization: Bearer <jwt>
Content-Type: application/json
```

This is the only float endpoint that requires an administrator JWT. It creates the initial configuration or edits `dailyFloat` and the expected remainder.

Request fields:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `dailyFloat` | number | Yes | Must be finite and greater than or equal to `0`. |
| `expectedRemainingBalance` | number | No | Must be finite and greater than or equal to `0`. |
| `tillNumber` | string | No | Retailer till identifier. |
| `storeNumber` | string | No | Retailer store identifier. |

Initial setup:

```json
{
  "dailyFloat": 10000,
  "tillNumber": "TILL-001",
  "storeNumber": "STORE-001"
}
```

On first setup, `expectedRemainingBalance` is set to `dailyFloat`.

Explicitly reset both values:

```json
{
  "dailyFloat": 10000,
  "expectedRemainingBalance": 8000,
  "tillNumber": "TILL-001",
  "storeNumber": "STORE-001"
}
```

When updating an existing configuration, omitting `expectedRemainingBalance` preserves its current value. This allows the configured float to be changed without silently resetting the settlement control balance.

Successful response:

```json
{
  "merchantId": "pay_retailer_001",
  "currency": "KES",
  "dailyFloat": 10000,
  "expectedRemainingBalance": 8000,
  "tillNumber": "TILL-001",
  "storeNumber": "STORE-001",
  "updatedAt": "2026-09-28T19:35:00.000Z"
}
```

### 2.3 Access and configuration errors

- `401 Unauthorized`: missing or invalid bearer JWT for `GET` and deposit requests; missing or invalid JWT for `PUT`.
- `403 Forbidden`: authenticated user does not belong to the requested retailer; or the `PUT` caller is not `ADMIN` or `SUPER_ADMIN`.
- `404 Not Found`: merchant integration does not exist or is not a retailer.
- `409 Conflict`: the retailer has an active escrow transfer. Wait for a final transfer result before changing the float.
- `400 Bad Request`: a value is missing, non-numeric, non-finite, or negative.

The active-transfer restriction prevents an administrator from changing the expected remainder while a balance check or payout is using the old value.

## 3. M-Pesa configuration

Configure one dedicated `MPESA_RETAILER_*` set for the retailer account. These credentials are used for retailer float-deposit STK Push, Account Balance, and retailer-to-PayAssure B2B transfer. Regular customer STK Push, B2C, regular B2B, and other non-retailer operations continue to use the shared `MPESA_*` configuration.

```dotenv
MPESA_RETAILER_ENVIRONMENT=production
MPESA_RETAILER_CONSUMER_KEY=<retailer-consumer-key>
MPESA_RETAILER_CONSUMER_SECRET=<retailer-consumer-secret>
MPESA_RETAILER_SHORTCODE=<retailer-shortcode>
MPESA_RETAILER_PASSKEY=<retailer-stk-passkey>
MPESA_RETAILER_PARTY_A=<retailer-party-a>
MPESA_RETAILER_INITIATOR_NAME=<retailer-initiator>
MPESA_RETAILER_INITIATOR_PASSWORD=<retailer-initiator-password>
MPESA_RETAILER_CALLBACK_URL=https://api.example.com/payments
MPESA_RETAILER_PAYASSURE_SHORTCODE=<payassure-receiving-shortcode>
```

Details:

- `MPESA_RETAILER_PARTY_A` is optional and defaults to `MPESA_RETAILER_SHORTCODE`.
- `MPESA_RETAILER_PASSKEY` is required for retailer float-deposit STK Push.
- Account Balance and escrow B2B use the existing `ProductionCertificate.cer` certificate.
- `MPESA_RETAILER_CALLBACK_URL` must be publicly reachable by Safaricom. The application appends the callback paths below.
- Never commit real credentials, security credentials, or certificates to source control.
- The retailer environment must match the credentials. Sandbox credentials must not be used with production endpoints.

## 4. Retailer float deposit

An administrator can ask the retailer to add money to its float through a retailer-specific STK Push:

```http
POST /escrow/retailer/float/deposits
Authorization: Bearer <retailer-jwt>
Content-Type: application/json
```

The bearer token user must belong to an active retailer integration. The application resolves the retailer merchant ID from the token owner, and that retailer must already have a float configuration.

Request:

```json
{
  "amount": 5000,
  "payerPhoneNumber": "254700000000"
}
```

Rules:

- `amount` must be a positive integer KES amount.
- `payerPhoneNumber` must be a valid Kenyan phone number.
- The STK request uses `MPESA_RETAILER_CONSUMER_KEY`, `MPESA_RETAILER_CONSUMER_SECRET`, `MPESA_RETAILER_SHORTCODE`, and `MPESA_RETAILER_PASSKEY`.
- The callback is isolated from normal settlement payment callbacks, so a float deposit cannot trigger settlement splitting.
- Creating the request or receiving an STK acceptance does not change `expectedRemainingBalance`.
- A successful callback increments `expectedRemainingBalance` by the confirmed deposit amount.
- A failed callback, amount mismatch, gateway failure, or timeout does not change the balance.
- Replayed callbacks are acknowledged without incrementing the balance again.

Accepted response:

```json
{
  "depositId": "clx_float_deposit_001",
  "merchantId": "pay_retailer_001",
  "amount": 5000,
  "payerPhoneNumber": "254700000000",
  "status": "SUBMITTED",
  "merchantRequestId": "ws_CO_001",
  "checkoutRequestId": "ws_CO_002",
  "responseCode": "0",
  "responseDescription": "Success"
}
```

The deposit lifecycle is `PENDING` -> `SUBMITTED` -> `SUCCEEDED` or `FAILED`. The final callback is received at:

```http
POST /payments/callbacks/mpesa/retailer-float-deposit/{depositId}
```

On success, the balance operation is:

```text
new expectedRemainingBalance = current expectedRemainingBalance + confirmed deposit amount
```

The callback handler returns HTTP `200` to Safaricom while recording the processing result internally.

## 5. End-to-end settlement flow

The flow applies when a live settlement contains a positive CASH amount.

### Step 1: Settlement initiation

The settlement service checks that the retailer has a float configuration. In production, a CASH settlement without a configured float is blocked before M-Pesa processing:

```text
Retailer escrow daily float is not configured for <merchantId>; CASH settlement was blocked.
```

Settlements without CASH do not need this float gate. Development and test settlements without a float continue through the existing mock escrow path.

### Step 2: Claim the float atomically

The service validates that:

- `cashAmount` is finite, positive, and an integer KES amount.
- A positive M-Pesa funding amount has a payer phone number.
- The retailer has no active escrow transfer.
- The stored `expectedRemainingBalance` is still the value read when the operation started.

Inside one database transaction, it claims the float and creates a `RetailerEscrowTransfer` with:

```text
status:     BALANCE_PENDING
mpesaStatus: NOT_REQUIRED or NOT_STARTED
requiredBalance: current expectedRemainingBalance
```

The settlement metadata records `escrowStatus: BALANCE_PENDING`, the transfer ID, `cashAmount`, and `mpesaAmount`. A concurrent request receives an error equivalent to:

```text
Another escrow transfer is already active or the expected float changed
```

### Step 3: Query the retailer Account Balance

The application sends an Account Balance request using the retailer credentials:

```json
{
  "Initiator": "<retailer-initiator>",
  "SecurityCredential": "<generated-security-credential>",
  "CommandID": "AccountBalance",
  "PartyA": "<retailer-party-a>",
  "IdentifierType": "2",
  "Remarks": "Retailer escrow balance query",
  "QueueTimeOutURL": "https://api.example.com/payments/callbacks/mpesa/escrow-balance-timeout/<transferId>",
  "ResultURL": "https://api.example.com/payments/callbacks/mpesa/escrow-balance/<transferId>"
}
```

Safaricom returns the result asynchronously. The parser accepts either `Result` or `result` and reads the `Working Account` entry from an account string such as:

```text
Working Account|KES|10850.00&Utility Account|KES|0.00
```

### Step 4: Verify the balance

The observed `Working Account` must be at least both:

1. The stored `expectedRemainingBalance`, to detect an unexpected decrease, and
2. The settlement's CASH amount, to ensure the requested transfer can be funded.

Successful balance verification:

- Pure CASH: `BALANCE_VERIFIED`, then `TRANSFER_PENDING`.
- Mixed CASH + M-Pesa: `BALANCE_VERIFIED`, then `WAITING_FOR_MPESA`.
- The float lock remains held in both cases.

Failure cases release the lock and fail the settlement:

- Non-zero Safaricom result code.
- Missing or unparseable `Working Account`.
- Observed balance below the expected remainder:
  `Escrow balance tampering detected: expected at least ... KES, observed ... KES.`
- Observed balance below the CASH amount:
  `Insufficient escrow balance: available ... KES; CASH amount required ... KES.`

### Step 5: Collect mixed M-Pesa funding, when required

For a settlement containing CASH and M-Pesa funding, STK Push starts only after the balance is verified. The request uses the shared `MPESA_*` credentials and includes the escrow transfer ID in `gatewayPayload` so the eventual callback can be associated with this transfer.

- STK request accepted: remain waiting for the final M-Pesa callback.
- Failed M-Pesa callback: mark the escrow transfer `FAILED`, release the float, and fail the settlement.
- Successful M-Pesa callback: set `mpesaStatus: SUCCESS` and dispatch the escrow B2B transfer.

### Step 6: Send the escrow B2B transfer

The B2B transfer is sent only when the funding gates pass:

- Pure CASH requires `BALANCE_VERIFIED`.
- Mixed funding requires successful M-Pesa funding.

The amount sent is the settlement's CASH amount only. The M-Pesa amount is not added to the retailer-to-PayAssure B2B transfer.

The request uses:

```text
PartyA:          retailer escrow party
PartyB:          MPESA_RETAILER_PAYASSURE_SHORTCODE
AccountReference: settlement merchant transaction reference
Remarks:         PayAssure escrow collection <reference>
```

The transfer is marked `TRANSFER_PENDING` before dispatch. A gateway rejection or request error marks it `FAILED`, releases the float lock, and leaves `expectedRemainingBalance` unchanged.

An accepted request is not proof that money arrived. The float is not reduced until the final Safaricom result callback is successful.

### Step 7: Final B2B callback and settlement split

For result code `0`, the application reloads the transfer transactionally and, if it is still pending:

1. Decreases `expectedRemainingBalance` by the CASH amount.
2. Clears `activeTransferId`.
3. Sets the transfer status to `SUCCEEDED`.
4. Stores the B2B callback payload.
5. Updates settlement escrow metadata.
6. Resumes supplier and retailer splitting/allocation.

A non-zero result:

- Sets the transfer to `FAILED`.
- Clears the active-transfer lock.
- Stores the callback and failure reason.
- Does not decrease the expected remainder.
- Does not split or allocate the settlement.

Repeated callbacks are idempotent. Once the transfer has advanced beyond the callback's expected state, the handler acknowledges it as a duplicate without applying the balance reduction twice.

## 5. Callback endpoints

Safaricom must be able to reach these public POST endpoints. All four callback handlers acknowledge with HTTP `200`, including when internal processing fails, so the gateway does not repeatedly redeliver the same callback solely because application processing returned an error.

| Purpose | Route |
| --- | --- |
| Account Balance result | `POST /payments/callbacks/mpesa/escrow-balance/{transferId}` |
| Account Balance queue timeout | `POST /payments/callbacks/mpesa/escrow-balance-timeout/{transferId}` |
| B2B transfer result | `POST /payments/callbacks/mpesa/escrow-transfer/{transferId}` |
| B2B transfer queue timeout | `POST /payments/callbacks/mpesa/escrow-transfer-timeout/{transferId}` |

`{transferId}` is the internal escrow transfer ID supplied when the request is created. Do not replace it with the merchant transaction reference.

## 6. Timeout and recovery behavior

### Account Balance timeout

If the transfer is still `BALANCE_PENDING`, the timeout handler:

- Sets the transfer to `FAILED`.
- Releases `activeTransferId`.
- Marks the settlement failed.
- Stores `M-Pesa account balance request timed out before a result was received`.

If a balance result already advanced the transfer, a later timeout is treated as a duplicate and does not roll the transfer back.

### B2B transfer timeout

A B2B timeout is different because the money may have moved even though the callback was not received. The handler deliberately leaves:

```text
transfer status: TRANSFER_PENDING
float lock:      retained
remainder:       unchanged
escrowStatus:    TRANSFER_OUTCOME_UNKNOWN
```

Settlement metadata records `transferTimeoutAt` and the timeout payload. The lock remains until a final B2B result callback confirms success or failure. Do not manually reset the float while this transfer is unresolved.

## 7. State reference

| Transfer state | Meaning | Float lock | Expected remainder |
| --- | --- | --- | --- |
| `BALANCE_PENDING` | Waiting for Account Balance result | Held | Unchanged |
| `BALANCE_MISMATCH` | Balance is missing, too low, or inconsistent | Released | Unchanged |
| `BALANCE_VERIFIED` | Balance passed verification | Held | Unchanged |
| `WAITING_FOR_MPESA` | Waiting for mixed-funding STK callback | Held | Unchanged |
| `TRANSFER_PENDING` | B2B request accepted or outcome unknown | Held | Unchanged |
| `SUCCEEDED` | B2B result confirmed success | Released | Decreased by CASH amount |
| `FAILED` | A balance, STK, or B2B operation failed | Released | Unchanged |

## 8. Operational checklist

Before enabling production CASH settlements:

- Configure a retailer float and verify it with `GET /escrow/retailers/{merchantId}/float`.
- Confirm the retailer integration is of type `RETAILER`.
- Set all required `MPESA_RETAILER_*` variables and use the correct environment.
- Confirm the callback base URL is public and uses HTTPS.
- Register or allow all four callback paths, including timeout paths.
- Confirm the retailer initiator is authorized for Account Balance and B2B.
- Confirm the security credential can be generated from the configured initiator password.
- Confirm the PayAssure receiving shortcode is correct.
- Never edit the float while `activeTransferId` is set.
- Investigate `TRANSFER_OUTCOME_UNKNOWN` before retrying, resetting, or releasing a float.

For an individual settlement, correlate the settlement ID, escrow `transferId`, merchant transaction reference, Safaricom conversation IDs, callback payload, and final `expectedRemainingBalance` in the application logs and database.
