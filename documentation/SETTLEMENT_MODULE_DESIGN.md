# Settlement Module - API Design Sketch

## Overview

New Settlement Module design with business API authentication flow. This module operates independently from the existing Auth Module and provides business-to-business (B2B) integration endpoints.

**Key Principle**: Businesses authenticate with API Key/Secret → Receive one-time token → Use token for settlement operations

---

## Authentication Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│            Business Application                        │
│            (External Partner)                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Step 1: API Key + Secret
                     ▼
        ┌────────────────────────────────────┐
        │ POST /settlement/authenticate       │
        │ (Verify API Credentials)           │
        │                                    │
        │ Returns: One-Time Token            │
        └────────────┬───────────────────────┘
                     │
                     │ Step 2: One-Time Token
                     ▼
        ┌────────────────────────────────────┐
        │ POST /settlement/initiate-settlement│
        │ (Process Settlement Payload)       │
        │                                    │
        │ Returns: Settlement Confirmation   │
        └────────────────────────────────────┘
                     │
                     │ Step 3: Optional Follow-ups
                     ▼
        ┌────────────────────────────────────┐
        │ GET /settlement/track/:settlementId │
        │ GET /settlement/transactions/:id    │
        │ POST /settlement/reconcile          │
        └────────────────────────────────────┘
```

---

## Endpoint Specifications

### Endpoint 1: Authenticate (Verify API Credentials)

**Route**: `POST /settlement/authenticate`

**Description**: Verify API key and secret, return one-time token for subsequent requests

**Authentication**: None (public endpoint, but validates API credentials)

**Request Body**:
```json
{
  "apiKey": "string",
  "apiSecret": "string"
}
```

**Expected Response (200 OK)**:
```json
{
  "success": true,
  "token": "one_time_token_abc123xyz789",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "business": {
    "id": "merchant_123",
    "businessName": "Fresh Store Ltd",
    "participantType": "RETAILER",
    "status": "LIVE"
  }
}
```

**Error Response (401 Unauthorized)**:
```json
{
  "statusCode": 401,
  "message": "Invalid API credentials",
  "error": "INVALID_CREDENTIALS"
}
```

**Error Response (404 Not Found)**:
```json
{
  "statusCode": 404,
  "message": "Business not found with provided API key",
  "error": "BUSINESS_NOT_FOUND"
}
```

**Error Response (403 Forbidden)**:
```json
{
  "statusCode": 403,
  "message": "Business account is not in LIVE status",
  "error": "BUSINESS_NOT_ACTIVE"
}
```

**Notes**:
- One-time token expires in 1 hour (3600 seconds)
- Token can only be used ONCE
- After use, it becomes invalid
- New token must be requested for each operation

---

### Endpoint 2: Initiate Settlement

**Route**: `POST /settlement/initiate-settlement`

**Description**: Submit settlement payload for processing

**Authentication**: Bearer token (one-time token from authenticate endpoint)

**Headers**:
```
Authorization: Bearer one_time_token_abc123xyz789
Content-Type: application/json
```

**Request Body**:
```json
{
  "amount": 50000,
  "currency": "KES",
  "settlementMethod": "BANK_TRANSFER",
  "settlementAccount": "account_123456",
  "reference": "BATCH_20260630_001",
  "description": "Daily sales settlement",
  "transactionItems": [
    {
      "itemId": "TXN_001",
      "type": "SALE",
      "amount": 25000,
      "description": "Product A sales"
    },
    {
      "itemId": "TXN_002",
      "type": "ADJUSTMENT",
      "amount": -5000,
      "description": "Refunds"
    }
  ],
  "metadata": {
    "batchId": "batch_20260630",
    "storeName": "Main Branch",
    "terminalId": "POS_001"
  }
}
```

**Expected Response (201 Created)**:
```json
{
  "success": true,
  "settlement": {
    "settlementId": "settlement_abc123",
    "status": "INITIATED",
    "amount": 50000,
    "currency": "KES",
    "reference": "BATCH_20260630_001",
    "createdAt": "2026-06-30T12:00:00Z",
    "estimatedProcessingTime": "24-48 hours"
  },
  "message": "Settlement request received and queued for processing"
}
```

**Error Response (401 Unauthorized)**:
```json
{
  "statusCode": 401,
  "message": "Invalid or expired one-time token",
  "error": "INVALID_TOKEN"
}
```

**Error Response (400 Bad Request)**:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "amount",
      "message": "Amount must be greater than 0"
    },
    {
      "field": "settlementMethod",
      "message": "Unsupported settlement method"
    }
  ]
}
```

**Error Response (409 Conflict)**:
```json
{
  "statusCode": 409,
  "message": "Settlement with this reference already exists",
  "error": "DUPLICATE_REFERENCE"
}
```

**Notes**:
- Token is consumed after this request (becomes invalid)
- Cannot reuse same token for another request
- Reference must be unique per business
- Amount validation: > 0 and within business limits
- Transaction items are optional but recommended

---

### Endpoint 3: Track Settlement Status

**Route**: `GET /settlement/track/:settlementId`

**Description**: Get current status of a settlement

**Authentication**: Bearer token (user JWT from Auth Module)

**Headers**:
```
Authorization: Bearer <jwt_token>
```

**URL Parameters**:
- `settlementId`: Settlement ID from initiate-settlement response

**Expected Response (200 OK)**:
```json
{
  "success": true,
  "settlement": {
    "settlementId": "settlement_abc123",
    "businessId": "merchant_123",
    "businessName": "Fresh Store Ltd",
    "status": "PROCESSING",
    "amount": 50000,
    "currency": "KES",
    "reference": "BATCH_20260630_001",
    "createdAt": "2026-06-30T12:00:00Z",
    "processedAt": "2026-06-30T12:30:00Z",
    "estimatedCompletionTime": "2026-07-01T12:00:00Z",
    "transactions": [
      {
        "transactionId": "txn_001",
        "itemId": "TXN_001",
        "type": "SALE",
        "amount": 25000,
        "status": "PROCESSING"
      }
    ]
  }
}
```

**Error Response (404 Not Found)**:
```json
{
  "statusCode": 404,
  "message": "Settlement not found",
  "error": "SETTLEMENT_NOT_FOUND"
}
```

---

### Endpoint 4: Get Transaction Details

**Route**: `GET /settlement/transactions/:transactionId`

**Description**: Get details of a specific transaction within a settlement

**Authentication**: Bearer token (user JWT from Auth Module)

**Expected Response (200 OK)**:
```json
{
  "success": true,
  "transaction": {
    "transactionId": "txn_001",
    "settlementId": "settlement_abc123",
    "itemId": "TXN_001",
    "type": "SALE",
    "amount": 25000,
    "currency": "KES",
    "status": "COMPLETED",
    "description": "Product A sales",
    "createdAt": "2026-06-30T12:00:00Z",
    "completedAt": "2026-06-30T14:00:00Z",
    "reference": "BATCH_20260630_001"
  }
}
```

---

### Endpoint 5: Reconcile Settlement

**Route**: `POST /settlement/reconcile`

**Description**: Submit reconciliation data to confirm settlement completion

**Authentication**: Bearer token (user JWT from Auth Module)

**Request Body**:
```json
{
  "settlementId": "settlement_abc123",
  "bankReference": "BANK_REF_20260630_001",
  "bankTransactionId": "bank_txn_789",
  "actualAmount": 50000,
  "actualProcessingTime": "12 hours",
  "notes": "Successfully processed through bank"
}
```

**Expected Response (200 OK)**:
```json
{
  "success": true,
  "settlement": {
    "settlementId": "settlement_abc123",
    "status": "COMPLETED",
    "reconciliationStatus": "VERIFIED",
    "reconciliationDetails": {
      "bankReference": "BANK_REF_20260630_001",
      "reconcileAt": "2026-06-30T14:30:00Z"
    }
  }
}
```

---

## Security Model

### One-Time Token Security

```
1. Generate: After successful API key/secret verification
   └─ Generated using secure random algorithm
   └─ Stored in cache/database with expiration

2. Validate: Before processing settlement request
   └─ Check token exists
   └─ Check token not expired
   └─ Check token not already used

3. Consume: After successful settlement initiation
   └─ Mark token as used/consumed
   └─ Remove from valid tokens
   └─ Token cannot be reused

4. Expire: After timeout or consumption
   └─ Token deleted from system
   └─ New token must be requested
```

### API Key/Secret Storage

```
Integration (from Onbordings Module)
├─ apiKey: Hashed (never stored plaintext)
├─ apiSecret: Hashed (never stored plaintext)
├─ apiKeyHash: Used for verification
└─ apiSecretHash: Used for verification

Flow:
1. Receive: apiKey + apiSecret from request
2. Hash: SHA256(apiKey) + SHA256(apiSecret)
3. Compare: Hashes against stored hashes
4. Match: Generate one-time token
5. Mismatch: Return 401 Unauthorized
```

---

## Status Lifecycle

### Settlement Status Flow

```
INITIATED
    ↓
PENDING_PROCESSING
    ↓
PROCESSING
    ├→ PROCESSING_COMPLETE
    │     ↓
    │   AWAITING_RECONCILIATION
    │     ↓
    │   COMPLETED (✓ Success)
    │
    └→ PROCESSING_FAILED
          ↓
        FAILED (✗ Error)
```

### Transaction Status Flow

```
INITIATED
    ↓
PROCESSING
    ├→ COMPLETED (✓)
    │
    ├→ PENDING (waiting for confirmation)
    │
    └→ FAILED (✗)
```

---

## Data Models (Settlement Module Specific)

### SettlementSession (One-Time Token Model)
```typescript
{
  id: string (CUID)
  businessId: string (FK to Integration.participantId)
  integrationId: string (FK to Integration)
  token: string (secure random)
  expiresAt: DateTime
  usedAt?: DateTime
  isUsed: boolean
  createdAt: DateTime
}
```

### Settlement
```typescript
{
  id: string (CUID)
  businessId: string (FK)
  integrationId: string (FK)
  amount: Decimal
  currency: string
  settlementMethod: string
  settlementAccount: string
  reference: string (unique per business)
  status: SettlementStatus
  transactions: Transaction[]
  bankReference?: string
  reconcilationStatus?: string
  createdAt: DateTime
  processedAt?: DateTime
  completedAt?: DateTime
  failedAt?: DateTime
  failureReason?: string
}
```

### Transaction
```typescript
{
  id: string (CUID)
  settlementId: string (FK)
  itemId: string
  type: TransactionType
  amount: Decimal
  description: string
  status: TransactionStatus
  createdAt: DateTime
  completedAt?: DateTime
}
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `INVALID_CREDENTIALS` | 401 | API key or secret incorrect |
| `BUSINESS_NOT_FOUND` | 404 | No business with this API key |
| `BUSINESS_NOT_ACTIVE` | 403 | Business not in LIVE status |
| `INVALID_TOKEN` | 401 | One-time token invalid/expired/used |
| `TOKEN_ALREADY_USED` | 401 | Token already consumed |
| `VALIDATION_FAILED` | 400 | Request data validation failed |
| `DUPLICATE_REFERENCE` | 409 | Reference already processed |
| `SETTLEMENT_NOT_FOUND` | 404 | Settlement ID doesn't exist |
| `INSUFFICIENT_BALANCE` | 400 | Amount exceeds available balance |
| `INVALID_SETTLEMENT_METHOD` | 400 | Settlement method not supported |

---

## Request/Response Flow Example

### Complete Flow: From Authentication to Settlement

```
═══════════════════════════════════════════════════════════
STEP 1: Business Authenticates
═══════════════════════════════════════════════════════════

REQUEST:
POST /settlement/authenticate
Content-Type: application/json

{
  "apiKey": "key_abc123",
  "apiSecret": "secret_xyz789"
}

RESPONSE: 200 OK
{
  "success": true,
  "token": "one_time_20260630_abc123xyz789",
  "expiresIn": 3600,
  "business": {
    "id": "merchant_123",
    "businessName": "Fresh Store Ltd"
  }
}

═══════════════════════════════════════════════════════════
STEP 2: Business Submits Settlement with Token
═══════════════════════════════════════════════════════════

REQUEST:
POST /settlement/initiate-settlement
Authorization: Bearer one_time_20260630_abc123xyz789
Content-Type: application/json

{
  "amount": 50000,
  "currency": "KES",
  "settlementMethod": "BANK_TRANSFER",
  "reference": "BATCH_20260630_001",
  "description": "Daily settlement",
  "transactionItems": [
    {
      "itemId": "TXN_001",
      "type": "SALE",
      "amount": 50000
    }
  ]
}

RESPONSE: 201 Created
{
  "success": true,
  "settlement": {
    "settlementId": "settlement_abc123",
    "status": "INITIATED",
    "amount": 50000,
    "reference": "BATCH_20260630_001"
  }
}

Note: Token is now CONSUMED and cannot be reused
Any attempt to reuse: 401 Unauthorized - Token already used

═══════════════════════════════════════════════════════════
STEP 3: Business Tracks Settlement Status (Later)
═══════════════════════════════════════════════════════════

REQUEST:
GET /settlement/track/settlement_abc123
Authorization: Bearer <user_jwt_token>

RESPONSE: 200 OK
{
  "success": true,
  "settlement": {
    "settlementId": "settlement_abc123",
    "status": "COMPLETED",
    "amount": 50000,
    "completedAt": "2026-06-30T14:00:00Z"
  }
}
```

---

## Integration with Onbordings Module

The Settlement Module uses:

- **Integration Model**: Stores API Key/Secret hashes
- **OnboardingParticipant**: Business information
- **Settlement Account**: Settlement preferences

```
OnboardingParticipant
├─ id: participant_id
├─ businessName: "Fresh Store Ltd"
├─ settlementMethod: "BANK_TRANSFER"
├─ settlementAccount: "account_123"
└─ integrations: [
    {
      id: integration_id
      apiKey: (hashed)
      apiSecret: (hashed)
      merchantId: "merchant_123"
      webhookUrl: "https://..."
    }
  ]
```

---

## Implementation Checklist

### Phase 1: Core Structure
- [ ] Create Settlement entities/models
- [ ] Create SettlementSession model for one-time tokens
- [ ] Create Settlement repository
- [ ] Create Settlement service

### Phase 2: Endpoint 1 - Authentication
- [ ] POST /settlement/authenticate
- [ ] Validate API credentials against Integration hashes
- [ ] Generate secure one-time token
- [ ] Store token in database with expiration
- [ ] Return token and business info

### Phase 3: Endpoint 2 - Settlement Initiation
- [ ] POST /settlement/initiate-settlement
- [ ] Validate one-time token
- [ ] Check token not already used
- [ ] Validate settlement payload
- [ ] Create settlement record
- [ ] Mark token as consumed
- [ ] Return settlement ID

### Phase 4: Endpoints 3-5 - Support Operations
- [ ] GET /settlement/track/:settlementId
- [ ] GET /settlement/transactions/:transactionId
- [ ] POST /settlement/reconcile
- [ ] Retrieve settlement status
- [ ] Validate user permissions

### Phase 5: Database & Migrations
- [ ] Create Settlement table
- [ ] Create Transaction table
- [ ] Create SettlementSession table
- [ ] Add indexes and constraints
- [ ] Create migration files

### Phase 6: Testing & Documentation
- [ ] Unit tests for service methods
- [ ] Integration tests for endpoints
- [ ] Update API documentation
- [ ] Add usage examples

---

## Key Design Decisions

1. **One-Time Tokens**: Consumed after use, prevents replay attacks
2. **Separate Auth**: Settlement auth separate from User auth (B2B vs B2C)
3. **API Key/Secret Hashing**: Hashed in database, compared with request hashes
4. **Status Tracking**: Multiple endpoints for tracking + reconciliation
5. **No JWT Requirement**: Initial auth doesn't require existing JWT
6. **Transaction Items**: Optional but recommended for detailed tracking

---

**Design Status**: Draft  
**Next Step**: Implementation of Phase 1 & 2
