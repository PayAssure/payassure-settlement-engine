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




{
  "merchantId": "pay_retailer_001",
  "merchantTransactionReference": "TXN-MIXED-20260916-000001",
  "totalAmount": 130280,
  "currency": "KES",
  "settlementMethod": "CASH_ESCROW",
  "description": "Large mixed cash and M-Pesa settlement for Nairobi regional sales batch",
  "paymentMethod": {
    "type": "MPESA",
    "payerPhoneNumber": "254791614036",
    "phoneNumber": "254791614036",
    "provider": "MPESA",
    "amount": 0
  },
  "paymentMethods": [
    {
      "type": "CASH",
      "amount": 45000,
      "provider": "ESCROW"
    },
    {
      "type": "MPESA",
      "amount": 85280,
      "provider": "MPESA",
      "payerPhoneNumber": "254791614036",
      "phoneNumber": "254791614036"
    }
  ],
  "callbackUrl": "https://merchant.example.com/api/payassure/settlement-callback",
  "transactionDate": "2026-09-16T14:30:00+03:00",
  "metadata": {
    "batchId": "BATCH-NAIROBI-20260916-001",
    "branchId": "NRB-WESTLANDS-001",
    "branchName": "Westlands Branch",
    "terminalId": "POS-WL-07",
    "salesAgent": "agent-042",
    "region": "NAIROBI",
    "collectionChannel": "CASH_AND_MPESA",
    "cashAmount": 45000,
    "mpesaAmount": 85280,
    "numberOfSuppliers": 4,
    "numberOfItems": 12,
    "notes": "Cash portion is expected to be collected from the retailer escrow account."
  },
  "suppliers": [
    {
      "supplierMerchantId": "pay_supplier_cement_001",
      "supplierTotalAmount": 38500,
      "retailerTotalAmount": 3250,
      "platformFee": 1100,
      "items": [
        {
          "itemReference": "CEMENT-50KG-001",
          "itemId": "ITEM-CEMENT-001",
          "itemName": "Bamburi Cement 50kg",
          "description": "Construction cement",
          "supplierAmount": 18000,
          "retailerAmount": 1500,
          "platformFee": 500,
          "quantity": 30,
          "unitPrice": 600
        },
        {
          "itemReference": "CEMENT-32KG-002",
          "itemId": "ITEM-CEMENT-002",
          "itemName": "Bamburi Cement 32.5R 50kg",
          "description": "General building cement",
          "supplierAmount": 12000,
          "retailerAmount": 1000,
          "platformFee": 350,
          "quantity": 20,
          "unitPrice": 600
        },
        {
          "itemReference": "CEMENT-42KG-003",
          "itemId": "ITEM-CEMENT-003",
          "itemName": "Ndarugo Cement 50kg",
          "description": "Premium construction cement",
          "supplierAmount": 8500,
          "retailerAmount": 750,
          "platformFee": 250,
          "quantity": 15,
          "unitPrice": 566.67
        }
      ]
    },
    {
      "supplierMerchantId": "pay_supplier_steel_002",
      "supplierTotalAmount": 32500,
      "retailerTotalAmount": 2700,
      "platformFee": 900,
      "items": [
        {
          "itemReference": "STEEL-BAR-001",
          "itemId": "ITEM-STEEL-001",
          "itemName": "Steel Reinforcement Bars 12mm",
          "description": "12mm steel reinforcement bars",
          "supplierAmount": 15000,
          "retailerAmount": 1200,
          "platformFee": 400,
          "quantity": 25,
          "unitPrice": 664
        },
        {
          "itemReference": "STEEL-BAR-002",
          "itemId": "ITEM-STEEL-002",
          "itemName": "Steel Reinforcement Bars 16mm",
          "description": "16mm steel reinforcement bars",
          "supplierAmount": 10500,
          "retailerAmount": 900,
          "platformFee": 300,
          "quantity": 15,
          "unitPrice": 780
        },
        {
          "itemReference": "STEEL-MESH-003",
          "itemId": "ITEM-STEEL-003",
          "itemName": "Steel Mesh Sheets",
          "description": "Heavy-duty steel mesh sheets",
          "supplierAmount": 7000,
          "retailerAmount": 600,
          "platformFee": 200,
          "quantity": 10,
          "unitPrice": 780
        }
      ]
    },
    {
      "supplierMerchantId": "pay_supplier_electrical_003",
      "supplierTotalAmount": 26500,
      "retailerTotalAmount": 2350,
      "platformFee": 730,
      "items": [
        {
          "itemReference": "ELEC-CABLE-001",
          "itemId": "ITEM-ELEC-001",
          "itemName": "Twin and Earth Cable 2.5mm",
          "description": "Electrical installation cable",
          "supplierAmount": 11000,
          "retailerAmount": 1000,
          "platformFee": 300,
          "quantity": 10,
          "unitPrice": 1230
        },
        {
          "itemReference": "ELEC-SWITCH-002",
          "itemId": "ITEM-ELEC-002",
          "itemName": "Industrial Light Switches",
          "description": "Heavy-duty electrical switches",
          "supplierAmount": 9000,
          "retailerAmount": 800,
          "platformFee": 250,
          "quantity": 30,
          "unitPrice": 335
        },
        {
          "itemReference": "ELEC-BREAKER-003",
          "itemId": "ITEM-ELEC-003",
          "itemName": "Circuit Breakers",
          "description": "Single-phase circuit breakers",
          "supplierAmount": 6500,
          "retailerAmount": 550,
          "platformFee": 180,
          "quantity": 10,
          "unitPrice": 723
        }
      ]
    },
    {
      "supplierMerchantId": "pay_supplier_plumbing_004",
      "supplierTotalAmount": 19500,
      "retailerTotalAmount": 1700,
      "platformFee": 550,
      "items": [
        {
          "itemReference": "PLUMB-PVC-001",
          "itemId": "ITEM-PLUMB-001",
          "itemName": "PVC Water Pipes",
          "description": "3/4 inch PVC water pipes",
          "supplierAmount": 8000,
          "retailerAmount": 700,
          "platformFee": 220,
          "quantity": 20,
          "unitPrice": 446
        },
        {
          "itemReference": "PLUMB-TAP-002",
          "itemId": "ITEM-PLUMB-002",
          "itemName": "Brass Water Taps",
          "description": "Heavy-duty brass water taps",
          "supplierAmount": 6500,
          "retailerAmount": 550,
          "platformFee": 180,
          "quantity": 10,
          "unitPrice": 723
        },
        {
          "itemReference": "PLUMB-FITTING-003",
          "itemId": "ITEM-PLUMB-003",
          "itemName": "PVC Pipe Fittings",
          "description": "Mixed PVC connectors and fittings",
          "supplierAmount": 5000,
          "retailerAmount": 450,
          "platformFee": 150,
          "quantity": 25,
          "unitPrice": 216
        }
      ]
    }
  ]
}