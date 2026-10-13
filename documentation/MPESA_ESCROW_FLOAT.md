# Retailer M-Pesa Escrow Float

This document describes retailer float deposits, retailer-level available balances within a shared M-Pesa escrow account, and hourly reconciliation against Safaricom's actual account balance.

## 1. Concept

Retailers share one M-Pesa escrow account. Each retailer's available amount is derived from callback-confirmed transaction records:

- `dailyFloat`: configuration metadata only; it does not create available funds.
- `availableBalance`: sum of that retailer's `SUCCEEDED` float deposits minus its `SUCCEEDED` escrow transfers. It is computed from callback-finalized records and is not stored or editable.
- `activeTransferId`: an internal lock identifying the settlement currently using the float. Only one escrow transfer may be active for a retailer at a time.

Settlement initiation trusts the retailer ledger rather than querying Safaricom for every transaction. An atomic check rejects a request if its CASH amount exceeds that retailer's available balance. The shared account is queried hourly; its observed balance is compared with the sum of all retailer ledger balances. A mismatch is persisted and logged for investigation.

Example:

```text
Configured remainder:       10,000 KES
Settlement CASH amount:       2,000 KES
Available before initiation:  10,000 KES
Available while pending:      10,000 KES
Available after success:       8,000 KES
```

The ledger is only debited after the successful B2B callback. A failed or unresolved transfer does not debit it.

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
  "availableBalance": 8000,
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

Creating a float configuration does not create available funds. Retailers must complete an STK deposit to establish a balance.

Explicitly reset both values:

```json
{
  "dailyFloat": 10000,
  "tillNumber": "TILL-001",
  "storeNumber": "STORE-001"
}
```

The endpoint cannot set or reset available funds. Unknown `expectedRemainingBalance` request fields are rejected by request validation.

Successful response:

```json
{
  "merchantId": "pay_retailer_001",
  "currency": "KES",
  "dailyFloat": 10000,
  "availableBalance": 8000,
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

The active-transfer restriction prevents an administrator from changing the expected remainder while a payout is in progress.

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
- Creating the request or receiving an STK acceptance does not add available funds.
- Only a successful callback with an exact amount match marks the deposit `SUCCEEDED`; that confirmed deposit is then included in the derived balance.
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
POST /payments/callbacks/mpesa/retailer-float-deposit/{depositId}?token=<deposit-callback-token>
```

The token is generated for the deposit and included only in the callback URL sent to M-Pesa. The handler rejects callbacks with a missing or invalid token before changing deposit status.

On success, the balance operation is:

```text
availableBalance = successful deposit total - successful settlement transfer total
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

### Step 2: Check and claim the retailer ledger atomically

The service validates that:

- `cashAmount` is finite, positive, and an integer KES amount.
- A positive M-Pesa funding amount has a payer phone number.
- The retailer has no active escrow transfer.
- Callback-confirmed available balance is at least the settlement CASH amount.

Inside one database transaction, it claims the retailer float and creates a `RetailerEscrowTransfer` with:

```text
status:     BALANCE_VERIFIED
mpesaStatus: NOT_REQUIRED or NOT_STARTED
requiredBalance: available balance at initiation
```

No Safaricom balance request is made during initiation. If the retailer has 10,000 KES and requests a CASH transfer of 11,000 KES, initiation fails with an available balance of 10,000 KES and a shortfall of 1,000 KES. The settlement metadata records `escrowStatus: BALANCE_VERIFIED`, the transfer ID, `cashAmount`, `mpesaAmount`, and the available balance. A concurrent request receives an error equivalent to:

```text
Another escrow transfer is already active or the expected float changed
```

### Step 3: Continue funding and payout

After the ledger check passes:

- Pure CASH dispatches the retailer-to-PayAssure B2B transfer immediately.
- Mixed CASH + M-Pesa starts STK funding, then dispatches the B2B transfer after the M-Pesa callback succeeds.
- The retailer float lock remains held until a final B2B result arrives.

### Step 3: Collect mixed M-Pesa funding, when required

For a settlement containing CASH and M-Pesa funding, STK Push starts after the retailer ledger check. The request uses the shared `MPESA_*` credentials and includes the escrow transfer ID in `gatewayPayload` so the eventual callback can be associated with this transfer.

- STK request accepted: remain waiting for the final M-Pesa callback.
- Failed M-Pesa callback: mark the escrow transfer `FAILED`, release the float, and fail the settlement.
- Successful M-Pesa callback: set `mpesaStatus: SUCCESS` and dispatch the escrow B2B transfer.

### Step 4: Send the escrow B2B transfer

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

The transfer is marked `TRANSFER_PENDING` before dispatch. A gateway rejection or request error marks it `FAILED` and releases the float lock. Failed transfers are excluded from the available-balance calculation.

An accepted request is not proof that money arrived. The float is not reduced until the final Safaricom result callback is successful.

### Step 5: Final B2B callback and settlement split

For result code `0`, the application reloads the transfer transactionally and, if it is still pending:

1. Sets the transfer status to `SUCCEEDED` and stores the B2B callback payload.
2. Clears `activeTransferId`.
3. Updates settlement escrow metadata.
4. Resumes supplier and retailer splitting/allocation.

The successful transfer record is the debit event. No separate balance field is incremented or decremented.

A non-zero result:

- Sets the transfer to `FAILED`.
- Clears the active-transfer lock.
- Stores the callback and failure reason.
- Does not decrease the expected remainder.
- Does not split or allocate the settlement.

Repeated callbacks are idempotent. Once the transfer has advanced beyond the callback's expected state, the handler acknowledges it as a duplicate without applying the balance reduction twice.

## 5. Hourly shared-account reconciliation

The application submits an M-Pesa Account Balance query once per hour, beginning one hour after startup. Expected balance is all callback-confirmed deposits minus all callback-confirmed successful settlement transfers. The result is compared with the shared account's `Working Account` balance and stored in `retailer_escrow_reconciliations`.

Reconciliation outcomes are `MATCHED`, `MISMATCH`, or `FAILED`. A mismatch stores the expected balance, observed balance, difference, and callback payload, and emits an error log marked `INVESTIGATION_REQUIRED`. A timeout, rejected request, or unparseable balance is stored as `FAILED`.

Administrators can inspect the latest 50 results:

```http
GET /escrow/retailer/float/reconciliations
Authorization: Bearer <admin-jwt>
```

Apply the database migration before deploying the scheduler:

```bash
npx prisma migrate deploy
npx prisma generate
```

The migration removes the old mutable `expectedRemainingBalance` column. After deployment, available balances are reconstructed from successful deposit and transfer records; configured daily float values do not count as deposits.

## 6. Callback endpoints

Safaricom must be able to reach these public POST endpoints. The callback handlers acknowledge with HTTP `200`, including when internal processing fails, so the gateway does not repeatedly redeliver the same callback solely because application processing returned an error.

| Purpose | Route |
| --- | --- |
| Retailer float deposit result | `POST /payments/callbacks/mpesa/retailer-float-deposit/{depositId}?token={callbackToken}` |
| Hourly shared-account reconciliation result | `POST /payments/callbacks/mpesa/escrow-reconciliation/{reconciliationId}` |
| Hourly shared-account reconciliation timeout | `POST /payments/callbacks/mpesa/escrow-reconciliation-timeout/{reconciliationId}` |
| B2B transfer result | `POST /payments/callbacks/mpesa/escrow-transfer/{transferId}` |
| B2B transfer queue timeout | `POST /payments/callbacks/mpesa/escrow-transfer-timeout/{transferId}` |

`{transferId}` is the internal escrow transfer ID supplied when the request is created. Do not replace it with the merchant transaction reference.

## 7. Timeout and recovery behavior

### Reconciliation timeout

A reconciliation timeout marks only that reconciliation record `FAILED`. It does not alter retailer balances or block settlements; the next hourly reconciliation can retry.

### B2B transfer timeout

A B2B timeout is different because the money may have moved even though the callback was not received. The handler deliberately leaves:

```text
transfer status: TRANSFER_PENDING
float lock:      retained
remainder:       unchanged
escrowStatus:    TRANSFER_OUTCOME_UNKNOWN
```

Settlement metadata records `transferTimeoutAt` and the timeout payload. The lock remains until a final B2B result callback confirms success or failure. Do not manually reset the float while this transfer is unresolved.

## 8. State reference

| Transfer state | Meaning | Float lock | Expected remainder |
| --- | --- | --- | --- |
| `BALANCE_VERIFIED` | Retailer ledger check passed | Held | Unchanged |
| `WAITING_FOR_MPESA` | Waiting for mixed-funding STK callback | Held | Unchanged |
| `TRANSFER_PENDING` | B2B request accepted or outcome unknown | Held | Unchanged |
| `SUCCEEDED` | B2B result confirmed success | Released | Transfer amount is subtracted from the derived balance |
| `FAILED` | STK or B2B operation failed | Released | Excluded from the derived balance |

## 9. Operational checklist

Before enabling production CASH settlements:

- Configure a retailer float and verify it with `GET /escrow/retailers/{merchantId}/float`.
- Confirm the retailer integration is of type `RETAILER`.
- Set all required `MPESA_RETAILER_*` variables and use the correct environment.
- Confirm the callback base URL is public and uses HTTPS.
- Register or allow the deposit, B2B transfer, and hourly reconciliation callback paths, including timeout paths.
- Confirm the retailer initiator is authorized for Account Balance reconciliation and B2B.
- Confirm the security credential can be generated from the configured initiator password.
- Confirm the PayAssure receiving shortcode is correct.
- Never edit the float while `activeTransferId` is set.
- Investigate `TRANSFER_OUTCOME_UNKNOWN` before retrying, resetting, or releasing a float.

For an individual settlement, correlate the settlement ID, escrow `transferId`, merchant transaction reference, Safaricom conversation IDs, callback payload, and successful deposit/transfer records. For account reconciliation, review the latest run and investigate any `MISMATCH`; balances cannot be manually reset through the float configuration API.
