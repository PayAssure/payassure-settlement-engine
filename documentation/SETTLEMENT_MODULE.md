# Settlement Module Documentation

## Overview

The Settlement Module handles settlement-related operations for the Payassure Settlement Engine. It manages the processing of settlements between retailers, suppliers, and the platform, including settlement tracking, reconciliation, and financial transactions.

**Location**: `src/settlement/`

**Status**: Currently in development/placeholder phase

## Features (Current & Planned)

### Current Features
- Health check endpoint
- Basic settlement status monitoring

### Planned Features
- Settlement processing and transactions
- Settlement reconciliation
- Payment routing and distribution
- Settlement history and reporting
- Dispute management
- Multi-currency support
- Settlement scheduling

## Core Components

### 1. SettlementController (`settlement.controller.ts`)

Main entry point for settlement endpoints.

**Current Endpoints**:

#### GET `/settlement/health`
- **Description**: Get settlement module health status
- **Auth Required**: No
- **Returns**: 
  ```json
  {
    "status": "ok"
  }
  ```
- **Status Code**: 200
- **Purpose**: Monitoring and health checks

**Planned Endpoints**:

#### POST `/settlement/initiate`
- **Description**: Initiate a new settlement
- **Auth Required**: Yes (Bearer Token)
- **Body** (proposed):
  ```json
  {
    "participantId": "string",
    "amount": number,
    "currency": "string",
    "settlementMethod": "string",
    "reference": "string"
  }
  ```
- **Returns**: Settlement confirmation

#### GET `/settlement/:id`
- **Description**: Get settlement details
- **Auth Required**: Yes
- **URL Parameters**:
  - `id`: Settlement ID

#### GET `/settlement/participant/:participantId`
- **Description**: Get all settlements for a participant
- **Auth Required**: Yes
- **URL Parameters**:
  - `participantId`: Onboarding participant ID

#### POST `/settlement/:id/reconcile`
- **Description**: Reconcile a settlement
- **Auth Required**: Yes (Admin)
- **Body**: Reconciliation data

#### GET `/settlement/reports/summary`
- **Description**: Get settlement summary report
- **Auth Required**: Yes (Admin)

### 2. SettlementService (`settlement.service.ts`)

Core business logic for settlement operations.

**Current Methods**:

#### `getHelloText(): Promise<string>`
- Retrieves test data from database
- Returns: `"no hello found"` if no records exist
- Used for basic functionality testing

**Planned Methods**:

#### `initiateSettlement(data: InitiateSettlementDto, user: User): Promise<SettlementDto>`
- Creates new settlement record
- Validates participant status
- Checks available balance
- Returns settlement confirmation with ID

#### `getSettlement(id: string): Promise<SettlementDto>`
- Retrieves settlement details
- Includes transaction history
- Shows current status and amounts

#### `getParticipantSettlements(participantId: string, filters?: FilterDto): Promise<SettlementDto[]>`
- Lists all settlements for a participant
- Supports pagination and filtering by date/status
- Returns array of settlement records

#### `reconcileSettlement(settlementId: string, reconciliationData: any): Promise<SettlementDto>`
- Processes settlement reconciliation
- Verifies amounts and transactions
- Updates settlement status

#### `getSettlementReport(params: ReportParamsDto): Promise<SettlementReportDto>`
- Generates settlement summary report
- Includes totals, status breakdown, trends
- Supports filtering by date range and participant

### 3. SettlementRepository (`settlement.repository.ts`)

Data access layer for settlement operations.

**Current Methods**:

#### `findFirstHello(): Promise<Hello | null>`
- Retrieves first "Hello" record from database
- Used for testing ORM connectivity

**Planned Methods**:
- `createSettlement(data)` - Create settlement record
- `findSettlementById(id)` - Retrieve settlement
- `findSettlementsByParticipantId(participantId)` - List participant settlements
- `updateSettlementStatus(id, status)` - Update status
- `createTransaction(data)` - Record transaction
- `findTransactionsBySettlementId(id)` - List transactions

## Data Models (Proposed)

### Settlement Entity (Planned)
```typescript
{
  id: string (CUID)
  participantId: string (FK to OnboardingParticipant)
  initiatedBy: string (FK to User)
  amount: Decimal
  currency: string
  status: SettlementStatus
  settlementMethod: string
  reference: string
  notes?: string
  processedAt?: DateTime
  completedAt?: DateTime
  failedAt?: DateTime
  failureReason?: string
  createdAt: DateTime
  updatedAt: DateTime
  transactions: Transaction[]
}
```

### Transaction Entity (Planned)
```typescript
{
  id: string (CUID)
  settlementId: string (FK)
  type: TransactionType
  fromParticipant: string (FK)
  toParticipant: string (FK)
  amount: Decimal
  currency: string
  status: TransactionStatus
  reference: string
  processedAt: DateTime
  createdAt: DateTime
}
```

### SettlementStatus Enum (Proposed)
```typescript
enum SettlementStatus {
  PENDING = "PENDING"
  PROCESSING = "PROCESSING"
  RECONCILING = "RECONCILING"
  COMPLETED = "COMPLETED"
  FAILED = "FAILED"
  REJECTED = "REJECTED"
}
```

### TransactionType Enum (Proposed)
```typescript
enum TransactionType {
  PAYOUT = "PAYOUT"
  DEDUCTION = "DEDUCTION"
  ADJUSTMENT = "ADJUSTMENT"
  REFUND = "REFUND"
}
```

## Data Transfer Objects (DTOs)

### Planned DTOs

#### InitiateSettlementDto
```typescript
{
  participantId: string
  amount: number
  currency: string
  settlementMethod: string
  reference: string
  notes?: string
}
```

#### SettlementDto
```typescript
{
  id: string
  participantId: string
  amount: number
  currency: string
  status: SettlementStatus
  settlementMethod: string
  reference: string
  createdAt: DateTime
  processedAt?: DateTime
  completedAt?: DateTime
  transactions?: TransactionDto[]
}
```

#### TransactionDto
```typescript
{
  id: string
  settlementId: string
  type: TransactionType
  fromParticipant: string
  toParticipant: string
  amount: number
  currency: string
  status: TransactionStatus
  reference: string
  processedAt: DateTime
}
```

#### SettlementReportDto
```typescript
{
  period: {
    startDate: DateTime
    endDate: DateTime
  }
  summary: {
    totalSettlements: number
    totalAmount: number
    completedCount: number
    pendingCount: number
    failedCount: number
  }
  byStatus: {
    [status: SettlementStatus]: {
      count: number
      amount: number
    }
  }
  byParticipant: ParticipantSettlementDto[]
  trends: {
    daily: DailySummaryDto[]
  }
}
```

## Settlement Processing Workflow (Planned)

### Phase 1: Initiation
```
1. Participant submits settlement request
2. Service validates:
   - Participant status is LIVE
   - Amount doesn't exceed available balance
   - Settlement method is configured
3. Settlement created with status: PENDING
4. Confirmation returned to participant
```

### Phase 2: Processing
```
1. Settlement scheduled for batch processing
2. System validates all settlement details
3. Funds allocated from participant account
4. Status updated to: PROCESSING
5. Webhooks notify participant
```

### Phase 3: Reconciliation
```
1. Settlement amounts verified
2. Bank transfer/payment processed
3. All transactions logged
4. Status updated to: RECONCILING
```

### Phase 4: Completion
```
1. Payment confirmed from bank/gateway
2. Reconciliation records updated
3. Status updated to: COMPLETED
4. Final webhook notification sent
5. Settlement archived for reporting
```

## Settlement Methods (Planned)

| Method | Description | Processing Time |
|--------|-------------|-----------------|
| BANK_TRANSFER | Direct bank wire | 1-2 business days |
| MOBILE_MONEY | Mobile payment service | 30 minutes |
| WALLET | Internal wallet transfer | Instant |
| CHECK | Physical check | 5-7 business days |
| ACH | Automated Clearing House | 1-2 business days |

## Security Considerations

1. **Authorization**: Only authorized users can initiate settlements
2. **Audit Trail**: All settlement actions logged with user/timestamp
3. **Reconciliation**: Settlements reconciled before completion
4. **Dual Approval**: High-value settlements may require approval
5. **Encryption**: Sensitive financial data encrypted at rest
6. **PCI Compliance**: If handling card data, ensure PCI DSS compliance
7. **Rate Limiting**: Prevent settlement flooding attacks
8. **Transaction Validation**: Verify all amounts and participants

## Integration with Other Modules

### Auth Module
- Validates user authorization
- Checks user role permissions
- Logs settlement actions for audit trail

### Onbordings Module
- Validates participant exists and is LIVE
- Retrieves settlement method from participant config
- Updates participant balance after settlement
- Uses participant webhook for notifications

### Webhook System
- Notifies participants of settlement status changes
- Sends reconciliation ready notifications
- Provides real-time settlement updates

## Error Handling (Planned)

| Error | Status | Description |
|-------|--------|-------------|
| `ConflictException` | 409 | Participant status invalid for settlement |
| `ForbiddenException` | 403 | User not authorized |
| `BadRequestException` | 400 | Invalid settlement data |
| `NotFoundException` | 404 | Settlement or participant not found |
| `InsufficientFundsException` | 400 | Insufficient balance for settlement |

## Monitoring & Alerts (Planned)

- Settlement processing latency
- Failed settlement rate
- Reconciliation failures
- Unusual settlement patterns
- Large settlement alerts
- Daily settlement summary reports

## Performance Considerations

1. **Batch Processing**: Process settlements in batches during off-peak hours
2. **Caching**: Cache settlement methods and participant balances
3. **Indexing**: Index on participantId, status, createdAt for fast queries
4. **Pagination**: Always paginate settlement lists
5. **Async Processing**: Use background jobs for long-running operations

## Testing Strategy (Planned)

### Unit Tests
- Service method calculations
- Data validation
- Error handling

### Integration Tests
- Settlement creation workflow
- Participant lookup and validation
- Database persistence
- Webhook notifications

### End-to-End Tests
- Complete settlement lifecycle
- Multi-participant settlements
- Reconciliation workflow

## Future Enhancements

1. **Scheduled Settlements** - Recurring settlement scheduling
2. **Settlement Templates** - Predefined settlement configurations
3. **Multi-Currency Support** - Handle multiple currencies with conversion
4. **Advanced Analytics** - Settlement trends and predictive analytics
5. **Dispute Management** - Handle settlement disputes
6. **Real-time Tracking** - WebSocket updates for settlement status
7. **Settlement Calendar** - View settlement schedule and history
8. **Auto-Settlement** - Automatic settlement on conditions met
9. **Blockchain Integration** - Immutable settlement records
10. **Settlement Rules Engine** - Custom settlement logic per participant

## Configuration (Planned)

```environment
SETTLEMENT_BATCH_TIME=02:00 # Daily batch processing time
SETTLEMENT_MAX_AMOUNT=1000000 # Maximum settlement amount
SETTLEMENT_MIN_AMOUNT=100 # Minimum settlement amount
SETTLEMENT_APPROVAL_THRESHOLD=50000 # Amount requiring approval
SETTLEMENT_TIMEOUT=3600 # Processing timeout in seconds
```

## Database Migrations (Planned)

Future migrations will add:
- Settlement table
- Transaction table
- Settlement status history table
- Settlement dispute table
- Settlement method configuration table

---

**Module Path**: `src/settlement/`  
**Controller Route**: `/settlement`  
**Current Status**: Placeholder/Development  
**Priority**: High (Core functionality)  
**Key Dependencies**: Prisma ORM, crypto, validator

**Note**: This module is currently in early development. The documentation above includes both current functionality and detailed specifications for planned features.
