# Database Schema Documentation

## Overview

The Payassure Settlement Engine uses PostgreSQL as its primary database with Prisma ORM for database access and migrations. This document outlines all data models, relationships, and database structure.

**Database Provider**: PostgreSQL  
**ORM**: Prisma v5.0.0+  
**Schema Location**: `prisma/schema.prisma`

## Enums

### ParticipantType
Classifies onboarding participants

```typescript
enum ParticipantType {
  RETAILER   // Retail business
  SUPPLIER   // Supplier/Vendor
}
```

### ParticipantStatus
Tracks the lifecycle status of a participant's onboarding

```typescript
enum ParticipantStatus {
  DRAFT                // Initial creation, data entry phase
  DOCUMENTS_SUBMITTED  // Required documents provided
  VERIFIED             // KYC/KYB verification completed
  PILOT                // Testing integration phase
  LIVE                 // Production ready
  REJECTED             // Verification failed
}
```

**Status Transitions**:
```
DRAFT 
  ↓
DOCUMENTS_SUBMITTED 
  ├→ VERIFIED 
  │   ↓
  │   PILOT 
  │   ↓
  │   LIVE (Terminal)
  │
  └→ REJECTED (Terminal)
```

### UserRole
Authorization levels for user accounts

```typescript
enum UserRole {
  SUPER_ADMIN  // Platform administrator with full access
  ADMIN        // Administrator with limited access
  USER         // Standard user (participant/retailer)
}
```

**Permission Levels**:
| Role | Can Register Admins | Can List Users | Can Manage Participants | Can Execute Settlements |
|------|-------------------|----------------|------------------------|------------------------|
| SUPER_ADMIN | ✓ | ✓ | ✓ | ✓ |
| ADMIN | ✗ | ✓ | ✓ | ✓ |
| USER | ✗ | ✗ | Limited (own) | Limited (own) |

## Data Models

### 1. Hello

Simple test/utility model for verifying database connectivity.

**Purpose**: Testing ORM and database connection

```typescript
model Hello {
  id   Int    @id @default(autoincrement())
  text String
}
```

**Fields**:
- `id` (Int, PK): Auto-incrementing integer identifier
- `text` (String): Text content

**Indexes**: Primary key on `id`

**Example Data**:
```
id | text
---|-----
1  | "Hello, Payassure!"
```

---

### 2. User

Represents user accounts in the system.

```typescript
model User {
  id                  String   @id @default(cuid())
  username            String   @unique
  email               String   @unique
  passwordHash        String
  role                UserRole @default(USER)
  isActive            Boolean  @default(true)
  refreshTokenVersion Int      @default(0)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

**Fields**:
- `id` (String, PK): CUID (Collision-resistant ID)
- `username` (String, Unique): Username for login
- `email` (String, Unique): Email address for login and communication
- `passwordHash` (String): Bcrypt hashed password (never store plaintext)
- `role` (UserRole): Authorization level
- `isActive` (Boolean): Account active status (soft delete)
- `refreshTokenVersion` (Int): Token invalidation counter
- `createdAt` (DateTime): Account creation timestamp
- `updatedAt` (DateTime): Last modification timestamp

**Indexes**:
- Primary key on `id`
- Unique index on `username`
- Unique index on `email`

**Relationships**:
- None directly (but related to OnboardingParticipant via email)

**Example Data**:
```
id          | username   | email           | role  | isActive | refreshTokenVersion
------------|------------|-----------------|-------|----------|--------------------
abc123      | superadmin | admin@pay.com   | SUPER_ADMIN | true | 0
def456      | retailer1  | store@pay.com   | USER  | true | 2
ghi789      | admin1     | adm@pay.com     | ADMIN | true | 1
```

**Business Rules**:
- Username must be 3-50 characters
- Email must be valid format
- Password must meet complexity requirements
- Email must be unique across system
- Username must be unique across system
- `refreshTokenVersion` incremented on logout to invalidate tokens

---

### 3. OnboardingParticipant

Represents retailers and suppliers going through onboarding.

```typescript
model OnboardingParticipant {
  id                    String             @id @default(cuid())
  participantType       ParticipantType
  businessName          String
  registrationNumber    String?
  kraPin                String?
  businessType          String?
  industry              String?
  physicalAddress       String?
  contactName           String?
  email                 String?
  phoneNumber           String?
  settlementMethod      String?
  settlementAccount     String?
  posSystem             String?
  webhookUrl            String?
  settlementPreference  String?
  status                ParticipantStatus  @default(DRAFT)
  integrations          Integration[]
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
}
```

**Fields**:

| Field | Type | Required | Unique | Description |
|-------|------|----------|--------|-------------|
| `id` | String | ✓ | ✓ | CUID identifier |
| `participantType` | ParticipantType | ✓ | ✗ | RETAILER or SUPPLIER |
| `businessName` | String | ✓ | ✗ | Legal business name |
| `registrationNumber` | String | ✗ | ✗ | Government registration |
| `kraPin` | String | ✗ | ✗ | KRA PIN (Kenya tax ID) |
| `businessType` | String | ✗ | ✗ | Type of business |
| `industry` | String | ✗ | ✗ | Industry classification |
| `physicalAddress` | String | ✗ | ✗ | Street address |
| `contactName` | String | ✗ | ✗ | Contact person name |
| `email` | String | ✗ | ✗ | Contact email |
| `phoneNumber` | String | ✗ | ✗ | Contact phone |
| `settlementMethod` | String | ✗ | ✗ | BANK_TRANSFER, MOBILE_MONEY, etc |
| `settlementAccount` | String | ✗ | ✗ | Settlement account details |
| `posSystem` | String | ✗ | ✗ | POS system in use |
| `webhookUrl` | String | ✗ | ✗ | Webhook endpoint URL |
| `settlementPreference` | String | ✗ | ✗ | Settlement frequency/preference |
| `status` | ParticipantStatus | ✓ | ✗ | Current onboarding status |
| `createdAt` | DateTime | ✓ | ✗ | Created timestamp |
| `updatedAt` | DateTime | ✓ | ✗ | Last updated timestamp |

**Relationships**:
- One-to-Many with `Integration` (cascade delete)

**Indexes**:
- Primary key on `id`
- Index on `email` (for quick lookup)
- Index on `status` (for status-based queries)
- Index on `createdAt` (for date-based filtering)

**Example Data**:
```
id      | participantType | businessName      | status   | email           | createdAt
--------|-----------------|------------------|----------|-----------------|----------
par001  | RETAILER        | Fresh Store Ltd   | VERIFIED | fresh@store.com | 2026-01-15
par002  | SUPPLIER        | Wholesale Co      | LIVE     | supplier@wh.com | 2025-12-01
par003  | RETAILER        | Tech Shop         | DRAFT    | tech@shop.com   | 2026-06-25
```

**Business Rules**:
- `businessName` is required and minimum 2 characters
- Status progression must follow: DRAFT → DOCUMENTS_SUBMITTED → VERIFIED → PILOT → LIVE
- Cannot skip status levels
- REJECTED is terminal status
- Each participant tracks onboarding progress
- Email should match User.email for linked accounts

---

### 4. Integration

Represents third-party integrations configured for participants.

```typescript
model Integration {
  id              String               @id @default(cuid())
  participantId   String
  participant     OnboardingParticipant @relation(fields: [participantId], references: [id], onDelete: Cascade)
  merchantId      String               @unique
  apiKey          String?
  apiSecret       String?
  apiKeyHash      String
  apiSecretHash   String
  environment     String               @default("production")
  webhookUrl      String?
  isActive        Boolean              @default(true)
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt
}
```

**Fields**:

| Field | Type | Required | Unique | Description |
|-------|------|----------|--------|-------------|
| `id` | String | ✓ | ✓ | CUID identifier |
| `participantId` | String | ✓ | ✗ | FK to OnboardingParticipant |
| `participant` | Relation | ✓ | ✗ | Navigation property |
| `merchantId` | String | ✓ | ✓ | Merchant identifier (external) |
| `apiKey` | String | ✗ | ✗ | API key (hashed before storage) |
| `apiSecret` | String | ✗ | ✗ | API secret (hashed before storage) |
| `apiKeyHash` | String | ✓ | ✗ | Hashed API key for verification |
| `apiSecretHash` | String | ✓ | ✗ | Hashed API secret for verification |
| `environment` | String | ✓ | ✗ | "production", "staging", "development" |
| `webhookUrl` | String | ✗ | ✗ | Webhook endpoint for events |
| `isActive` | Boolean | ✓ | ✗ | Integration active status |
| `createdAt` | DateTime | ✓ | ✗ | Created timestamp |
| `updatedAt` | DateTime | ✓ | ✗ | Last updated timestamp |

**Relationships**:
- Many-to-One with `OnboardingParticipant` (foreign key)
- Cascade delete: Deleting participant deletes all integrations

**Indexes**:
- Primary key on `id`
- Unique index on `merchantId`
- Index on `participantId` (for quick lookup by participant)
- Index on `environment` (for environment-based queries)

**Example Data**:
```
id     | participantId | merchantId    | environment | isActive | apiKeyHash
-------|---------------|---------------|-------------|----------|----------
int001 | par001        | MERCH_123456  | production  | true     | $2b$10$...
int002 | par001        | MERCH_123457  | staging     | true     | $2b$10$...
int003 | par002        | MERCH_789012  | production  | false    | $2b$10$...
```

**Business Rules**:
- `merchantId` must be unique (one integration per merchant)
- `apiKey` and `apiSecret` are stored as hashes only
- Original credentials returned only once to client
- Cannot be recovered if lost - new ones must be generated
- `isActive` allows disabling without deletion (audit trail)
- Cannot have integration without participant
- Deleting participant automatically deletes all integrations

---

### 5. OnboardingMessage

Utility model for storing system messages related to onboarding.

```typescript
model OnboardingMessage {
  id        Int      @id @default(autoincrement())
  message   String
  createdAt DateTime @default(now())
}
```

**Fields**:
- `id` (Int, PK): Auto-incrementing identifier
- `message` (String): Message content
- `createdAt` (DateTime): Creation timestamp

**Purpose**: Logging onboarding-related system messages and events

**Indexes**: Primary key on `id`

---

## Database Relationships

### Relationship Diagram

```
User
  ├─ (email linked to)
  └─> OnboardingParticipant
        └─ (1:N)
        └─> Integration
            └─ (apiKey hashed)
            └─ (apiSecret hashed)
```

### Detailed Relationships

#### User ↔ OnboardingParticipant
- **Type**: One-to-Many (implicit, via email)
- **Connection**: `User.email` matches `OnboardingParticipant.email`
- **Cardinality**: One user can have multiple participant records
- **Constraint**: No foreign key (email-based relationship)
- **Cascade**: No automatic cascading

#### OnboardingParticipant ↔ Integration
- **Type**: One-to-Many
- **Foreign Key**: `Integration.participantId` → `OnboardingParticipant.id`
- **Cardinality**: One participant can have multiple integrations
- **Constraint**: NOT NULL on `participantId`
- **Cascade Delete**: YES - Deleting participant deletes all integrations
- **Navigation**: `OnboardingParticipant.integrations` array

## Database Operations

### Common Queries

#### Create Participant
```typescript
const participant = await prisma.onboardingParticipant.create({
  data: {
    participantType: 'RETAILER',
    businessName: 'Store Name',
    status: 'DRAFT',
  },
});
```

#### Find by Email
```typescript
const participant = await prisma.onboardingParticipant.findUnique({
  where: { email: 'contact@store.com' },
  include: { integrations: true },
});
```

#### Update Status
```typescript
const updated = await prisma.onboardingParticipant.update({
  where: { id: 'par_123' },
  data: { status: 'VERIFIED' },
});
```

#### List with Pagination
```typescript
const participants = await prisma.onboardingParticipant.findMany({
  skip: 0,
  take: 10,
  where: { status: 'LIVE' },
  include: { integrations: true },
  orderBy: { createdAt: 'desc' },
});
```

#### Add Integration
```typescript
const integration = await prisma.integration.create({
  data: {
    participantId: 'par_123',
    merchantId: 'MERCHANT_456',
    environment: 'production',
    isActive: true,
  },
});
```

#### Delete Participant (with cascade)
```typescript
// All integrations deleted automatically
const deleted = await prisma.onboardingParticipant.delete({
  where: { id: 'par_123' },
});
```

## Migrations

### Migration History

**Location**: `prisma/migrations/`

#### Migration 1: `20260629140030_init`
Initial schema with all core models:
- Hello
- User
- OnboardingParticipant
- Integration
- OnboardingMessage

**Schema Changes**:
- Created all base tables
- Set up enums
- Added indexes and constraints

#### Migration 2: `20260629154326_add_integration_raw_keys`
Enhanced integration security:
- Added `apiKeyHash` field
- Added `apiSecretHash` field
- Prepared for hashed credential storage

**Schema Changes**:
- Added hash fields for API credentials
- Maintained backward compatibility

### Running Migrations

```bash
# Generate new migration
prisma migrate dev --name "migration_name"

# Apply migrations
prisma migrate deploy

# Reset database (development only)
prisma migrate reset

# Check migration status
prisma migrate status
```

## Performance Optimization

### Indexes Strategy

| Model | Field | Type | Reason |
|-------|-------|------|--------|
| User | username | Unique | Fast login lookup |
| User | email | Unique | Fast email lookup |
| OnboardingParticipant | email | Regular | Quick participant search |
| OnboardingParticipant | status | Regular | Filter by status |
| OnboardingParticipant | createdAt | Regular | Date-range queries |
| Integration | merchantId | Unique | Merchant lookup |
| Integration | participantId | Regular | Query by participant |

### Query Optimization Tips

1. **Always include relationships needed**:
   ```typescript
   // Good - includes integrations
   include: { integrations: true }
   
   // Avoid - requires separate query
   // select: { id: true, businessName: true }
   ```

2. **Use pagination for large datasets**:
   ```typescript
   take: 20,
   skip: (page - 1) * 20,
   ```

3. **Filter before sorting**:
   ```typescript
   where: { status: 'LIVE' },
   orderBy: { createdAt: 'desc' },
   ```

4. **Cache frequently accessed data**:
   - User roles
   - Participant statuses
   - Integration configurations

## Data Integrity

### Constraints

| Constraint | Type | Enforcement | Action |
|-----------|------|-------------|--------|
| User.username | Unique | Database | Reject duplicates |
| User.email | Unique | Database | Reject duplicates |
| Integration.merchantId | Unique | Database | Reject duplicates |
| Integration.participantId | Foreign Key | Database | Require valid participant |

### Referential Integrity

- **Cascade Delete**: Deleting participant → deletes integrations
- **No Orphans**: Integrations cannot exist without participant
- **Foreign Key Validation**: Database enforces referential integrity

## Backup & Recovery

### Data to Backup

Priority for backups:
1. User accounts (critical - authentication)
2. OnboardingParticipant (critical - business data)
3. Integration (high - configuration)
4. OnboardingMessage (medium - audit trail)

### Backup Strategy

```bash
# Full database backup
pg_dump payassure_db > backup_$(date +%Y%m%d).sql

# Restore from backup
psql payassure_db < backup_20260630.sql

# With Prisma
prisma db push  # Safe production push
```

## Database Configuration

### Connection String Format

```
postgresql://user:password@localhost:5432/payassure_db
```

### Environment Variables

```
DATABASE_URL="postgresql://user:password@localhost:5432/payassure"
```

### Production Considerations

1. Use managed database services (AWS RDS, Azure Database)
2. Enable automated backups
3. Set up replication/failover
4. Use connection pooling (PgBouncer)
5. Monitor query performance
6. Regular VACUUM and ANALYZE
7. Encryption at rest
8. SSL/TLS connections

## Schema Extension Guidelines

### Adding New Models

1. Define model in `schema.prisma`
2. Add required relationships
3. Add appropriate indexes
4. Create migration: `prisma migrate dev --name "add_model_name"`
5. Update DTOs
6. Add repository methods
7. Update documentation

### Adding New Fields

```typescript
// schema.prisma
model OnboardingParticipant {
  // ... existing fields
  newField String? // optional
  newRequired String // required
}
```

Then:
```bash
prisma migrate dev --name "add_field_name"
```

---

**Schema Version**: 2  
**Last Updated**: 2026-06-30  
**Database**: PostgreSQL 14+  
**ORM**: Prisma 5.0.0+
