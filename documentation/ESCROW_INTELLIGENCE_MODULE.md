# Escrow Intelligence Module
233500.00
This module continuously compares the expected escrow position held by PayAssure with the actual balance reported by the bank or custody provider. It is designed to run before settlement, flag mismatches, and block payout when the numbers do not reconcile.

## Purpose

The Escrow Intelligence layer is responsible for:

- tracking customer transactions by day
- calculating the expected escrow balance from PayAssure's ledger
- querying the bank or custody provider for actual balances and transactions
- reconciling expected vs actual values
- blocking settlement when a mismatch is detected
- recording alerts and reconciliation history for operations review

## Design Principles

- Expected balance is treated as the source of truth.
- The bank provider is abstracted behind an interface so a mock provider can be used first and replaced with a real API later without rewriting business logic.
- A reconciliation mismatch is a hard stop before settlement is approved.
- The system records reconciliation outcomes for operational auditing.

## Component Structure

### Service
- `EscrowIntelligenceService`
- Handles:
  - expected transaction tracking
  - expected balance calculations
  - provider balance lookups
  - mismatch detection
  - settlement blocking
  - reconciliation history

### Provider Interface
- `BankEscrowProvider`
- Defines the required contract for external provider integration:
  - `getCustomerEscrowBalance(customerId, asOfDate?)`
  - `getCustomerEscrowTransactions(customerId, asOfDate?)`
  - `getProviderName()`

### Mock Provider
- `MockBankEscrowProvider`
- Use as a stand-in until a real bank or custody API is connected.

### Controller
- `EscrowIntelligenceController`
- Exposes API endpoints for reconciliation, daily summaries, and history lookup.

## Reconciliation Rules

The reconciler enforces the following rules:

1. Calculate expected balance from the configured customer transactions for the target date.
2. Query the provider for the actual bank-reported escrow balance.
3. Compare actual balance with expected balance.
4. If the difference is non-zero, block settlement.
5. If the provider returns no transaction data for a customer that should have entries, also block settlement.
6. If the provider call fails, treat it as a reconciliation error and block settlement.

## API Endpoints

Base path: `/escrow`

### 1) GET /escrow/health
Checks whether the escrow intelligence service is available.

Example response:

```json
{
  "ok": true,
  "service": "escrow-intelligence"
}
```

### 2) POST /escrow/reconcile
Reconciles expected vs actual escrow balance for a customer on a given date.

Request body:

```json
{
  "customerId": "CUST-100",
  "date": "2026-09-12T00:00:00.000Z"
}
```

Example success response when matched:

```json
{
  "customerId": "CUST-100",
  "date": "2026-09-12",
  "status": "MATCHED",
  "expectedBalance": 1200,
  "actualBalance": 1200,
  "delta": 0,
  "transactionCount": 2,
  "blockedSettlement": false,
  "alerts": [],
  "provider": "MockBankEscrowProvider",
  "reconciledAt": "2026-09-12T09:00:00.000Z"
}
```

Example blocked response:

```json
{
  "customerId": "CUST-100",
  "date": "2026-09-12",
  "status": "BLOCKED",
  "expectedBalance": 1200,
  "actualBalance": 1100,
  "delta": -100,
  "transactionCount": 2,
  "blockedSettlement": true,
  "alerts": [
    "Escrow mismatch for CUST-100: expected 1200, actual 1100 (delta=-100)"
  ],
  "provider": "MockBankEscrowProvider",
  "reconciledAt": "2026-09-12T09:00:00.000Z"
}
```

### 3) GET /escrow/summary/:customerId
Fetches the daily summary for a customer and the selected date.

Query parameter:
- `date` (optional): ISO date string

Example:

```http
GET /escrow/summary/CUST-101?date=2026-09-12
```

Example response:

```json
{
  "customerId": "CUST-101",
  "date": "2026-09-12",
  "expectedBalance": 1325,
  "actualBalance": 1325,
  "delta": 0,
  "netMovement": 1325,
  "transactionCount": 3,
  "mismatch": false,
  "alerts": [],
  "blocked": false,
  "provider": "MockBankEscrowProvider"
}
```

### 4) GET /escrow/history
Returns the historical reconciliation attempts recorded by the service.

Example response:

```json
[
  {
    "customerId": "CUST-100",
    "date": "2026-09-12",
    "status": "BLOCKED",
    "expectedBalance": 1200,
    "actualBalance": 1100,
    "delta": -100,
    "transactionCount": 2,
    "blockedSettlement": true,
    "alerts": [
      "Escrow mismatch for CUST-100: expected 1200, actual 1100 (delta=-100)"
    ],
    "provider": "MockBankEscrowProvider",
    "reconciledAt": "2026-09-12T09:00:00.000Z"
  }
]
```

## Example Provider Contract

```ts
interface BankEscrowProvider {
  getCustomerEscrowBalance(customerId: string, asOfDate?: Date): Promise<{
    customerId: string;
    balance: number;
    currency?: string;
    asOf?: Date | string;
    source?: string;
  }>;

  getCustomerEscrowTransactions(customerId: string, asOfDate?: Date): Promise<Array<{
    id: string;
    customerId: string;
    date: string;
    type: string;
    amount: number;
    description?: string;
    currency?: string;
  }>>;

  getProviderName(): string;
}
```

## Typical Operational Flow

1. A customer ledger is stored in PayAssure as expected escrow activity.
2. The daily reconciliation job fetches the customer's expected transactions.
3. It computes the expected balance for that date.
4. The bank/custody provider returns the actual reported balance.
5. Comparison is made using strict rules.
6. If there is a mismatch, settlement is blocked and an alert is generated.
7. The reconciliation result is stored for audit/review.

## Notes

- The module is API-only and intentionally does not include a dashboard.
- This is production-ready for backend integration and can be extended with a real provider adapter as soon as the bank API contract is available.
- The mock provider is intended for local testing and integration validation before connecting to a live bank.
