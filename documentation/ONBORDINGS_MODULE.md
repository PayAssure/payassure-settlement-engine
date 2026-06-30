# Onbordings Module Documentation

## Overview

The Onbordings Module manages the complete onboarding process for retailers and suppliers joining the Payassure Settlement Engine platform. It handles participant creation, profile updates, integration management, API key generation, and webhook configuration.

**Location**: `src/onbordings/`

## Features

- **Participant Management** - Create and manage retailer/supplier profiles
- **Integration Management** - Manage third-party integrations for participants
- **API Key Generation** - Generate secure API credentials for integrations
- **Webhook Management** - Configure and manage webhook endpoints
- **Participant Status Tracking** - Track onboarding progress (DRAFT, VERIFIED, LIVE, etc.)
- **Settlement Configuration** - Manage settlement methods and preferences

## Core Components

### 1. OnbordingsController (`onbordings.controller.ts`)

Main entry point for onboarding endpoints.

**Endpoints**:

#### POST `/onbordings`
- **Description**: Create a retailer or supplier onboarding record
- **Auth Required**: No
- **Body**:
  ```json
  {
    "participantType": "RETAILER|SUPPLIER",
    "businessName": "string",
    "registrationNumber": "string (optional)",
    "kraPin": "string (optional)",
    "businessType": "string (optional)",
    "industry": "string (optional)",
    "physicalAddress": "string (optional)",
    "contactName": "string (optional)",
    "email": "string (optional)",
    "phoneNumber": "string (optional)",
    "settlementMethod": "string (optional)",
    "settlementAccount": "string (optional)",
    "posSystem": "string (optional)",
    "webhookUrl": "string (optional)",
    "settlementPreference": "string (optional)"
  }
  ```
- **Returns**: `OnboardingResponseDto`
- **Status Code**: 201
- **Error Handling**: 500 if unexpected error occurs

#### POST `/onbordings/generate-keys`
- **Description**: Generate API keys for the authenticated user
- **Auth Required**: Yes (Bearer Token)
- **Permissions**: Requires verified onboarding participant
- **Returns**: `OnboardingResponseDto` with generated credentials
- **Status Code**: 200
- **Errors**:
  - 401: Missing or invalid authentication token
  - 500: API key generation failed

#### GET `/onbordings`
- **Description**: List all onboarding participants
- **Auth Required**: Yes (Bearer Token)
- **Permissions**: Admin or owner
- **Returns**: `OnboardingResponseDto[]`
- **Status Code**: 200
- **Errors**: 401 if unauthorized

#### GET `/onbordings/:id`
- **Description**: Get a specific onboarding participant by ID
- **Auth Required**: Yes (Bearer Token)
- **URL Parameters**:
  - `id`: Participant ID (string)
- **Returns**: `OnboardingResponseDto`
- **Status Code**: 200
- **Errors**:
  - 401: Unauthorized
  - 404: Participant not found

#### PATCH `/onbordings/:id`
- **Description**: Update an onboarding participant's information
- **Auth Required**: Yes (Bearer Token)
- **URL Parameters**:
  - `id`: Participant ID (string)
- **Body**: Any fields from `CreateOnboardingDto` to update
- **Returns**: `OnboardingResponseDto`
- **Status Code**: 200
- **Errors**: 404 if participant not found

#### DELETE `/onbordings/:id`
- **Description**: Delete an onboarding participant
- **Auth Required**: Yes (Bearer Token)
- **Permissions**: Admin or owner
- **URL Parameters**:
  - `id`: Participant ID (string)
- **Status Code**: 204
- **Errors**: 404 if participant not found

#### POST `/onbordings/:id/integrations`
- **Description**: Add a new integration to a participant
- **Auth Required**: Yes (Bearer Token)
- **URL Parameters**:
  - `id`: Participant ID (string)
- **Body**:
  ```json
  {
    "merchantId": "string",
    "apiKey": "string (optional)",
    "apiSecret": "string (optional)",
    "environment": "production|staging|development",
    "webhookUrl": "string (optional)",
    "isActive": boolean
  }
  ```
- **Returns**: `OnboardingResponseDto`
- **Errors**:
  - 403: Permission denied
  - 404: Participant not found

#### GET `/onbordings/:id/integrations`
- **Description**: List all integrations for a participant
- **Auth Required**: Yes (Bearer Token)
- **URL Parameters**:
  - `id`: Participant ID (string)
- **Returns**: Array of integrations
- **Errors**: 404 if participant not found

#### PATCH `/onbordings/:id/integrations/:integrationId`
- **Description**: Update an existing integration
- **Auth Required**: Yes (Bearer Token)
- **URL Parameters**:
  - `id`: Participant ID (string)
  - `integrationId`: Integration ID (string)
- **Body**: Partial integration update
- **Returns**: `OnboardingResponseDto`
- **Errors**:
  - 403: Permission denied
  - 404: Integration or participant not found

#### POST `/onbordings/:id/webhook`
- **Description**: Update webhook configuration for a participant
- **Auth Required**: Yes (Bearer Token)
- **URL Parameters**:
  - `id`: Participant ID (string)
- **Body**:
  ```json
  {
    "webhookUrl": "string",
    "events": ["string"]
  }
  ```
- **Returns**: `OnboardingResponseDto`
- **Errors**: 404 if participant not found

### 2. OnbordingsService (`onbordings.service.ts`)

Core business logic for onboarding operations.

**Key Methods**:

#### `createParticipant(data: CreateOnboardingDto): Promise<OnboardingResponseDto>`
- Creates a new onboarding participant (retailer or supplier)
- Checks if user with email already exists
- Reuses participant if email matches existing one and status permits
- Returns completion message if user doesn't exist (prompts to register account)
- Initializes participant in DRAFT status

#### `findAllParticipants(): Promise<OnboardingResponseDto[]>`
- Retrieves all onboarding participants
- Includes associated integrations and user information
- Returns array of formatted response objects

#### `findParticipantById(id: string): Promise<OnboardingResponseDto>`
- Retrieves a specific participant by ID
- Throws `NotFoundException` if not found
- Includes all associated data (integrations, user info)

#### `updateParticipant(id: string, data: UpdateOnboardingDto): Promise<OnboardingResponseDto>`
- Updates participant information
- Supports partial updates
- Throws `NotFoundException` if participant doesn't exist
- Updates `updatedAt` timestamp

#### `deleteParticipant(id: string): Promise<void>`
- Deletes a participant and all associated integrations
- Cascading delete handled by database

#### `addIntegration(participantId: string, data: CreateIntegrationDto): Promise<OnboardingResponseDto>`
- Adds a new integration to a participant
- Hashes API keys for security
- Sets environment (production, staging, development)
- Throws `NotFoundException` if participant doesn't exist

#### `generateApiKeys(user: any): Promise<OnboardingResponseDto>`
- Generates new API credentials for authenticated user
- Validates user has onboarding record
- Creates secure API key and secret
- Hashes credentials before storage
- Throws error if generation fails

#### `updateIntegration(participantId: string, integrationId: string, data: UpdateIntegrationDto): Promise<OnboardingResponseDto>`
- Updates integration configuration
- Can update merchant ID, webhook URL, active status
- Throws `ForbiddenException` if user not authorized
- Throws `NotFoundException` if integration not found

#### `updateWebhook(participantId: string, data: UpdateWebhookDto): Promise<OnboardingResponseDto>`
- Updates webhook URL and event subscriptions
- Used for receiving settlement notifications
- Validates webhook URL format
- Stores event types for filtering

### 3. OnbordingsRepository (`onbordings.repository.ts`)

Data access layer for participant and integration operations.

**Key Methods**:
- `createParticipantWithoutIntegration(data)` - Create new participant
- `findParticipantById(id)` - Retrieve participant
- `findAllParticipants()` - List all participants
- `findParticipantByEmail(email)` - Find by email
- `findUserByEmail(email)` - Check if user account exists
- `updateParticipant(id, data)` - Update participant
- `deleteParticipant(id)` - Delete participant
- `createIntegration(data)` - Add integration
- `findIntegrationById(id)` - Retrieve integration
- `findIntegrationsByParticipantId(participantId)` - List participant integrations
- `updateIntegration(id, data)` - Update integration
- `deleteIntegration(id)` - Delete integration

## Data Models

### Participant (OnboardingParticipant)

```typescript
{
  id: string (CUID)
  participantType: "RETAILER" | "SUPPLIER"
  businessName: string
  registrationNumber?: string
  kraPin?: string
  businessType?: string
  industry?: string
  physicalAddress?: string
  contactName?: string
  email?: string
  phoneNumber?: string
  settlementMethod?: string
  settlementAccount?: string
  posSystem?: string
  webhookUrl?: string
  settlementPreference?: string
  status: ParticipantStatus
  integrations: Integration[]
  createdAt: DateTime
  updatedAt: DateTime
}
```

### Integration

```typescript
{
  id: string (CUID)
  participantId: string (FK)
  merchant_id: string (unique)
  apiKey?: string
  apiSecret?: string
  apiKeyHash: string
  apiSecretHash: string
  environment: "production" | "staging" | "development"
  webhookUrl?: string
  isActive: boolean
  createdAt: DateTime
  updatedAt: DateTime
}
```

## Participant Status Lifecycle

| Status | Description | Can Transition To |
|--------|-------------|-------------------|
| DRAFT | Initial creation, incomplete data | DOCUMENTS_SUBMITTED |
| DOCUMENTS_SUBMITTED | Documentation provided | VERIFIED, REJECTED |
| VERIFIED | KYC/KYB verification passed | PILOT |
| PILOT | Testing integration | LIVE |
| LIVE | Production ready | (none) |
| REJECTED | Failed verification | (none) |

## Data Transfer Objects (DTOs)

### CreateOnboardingDto
```typescript
{
  participantType: "RETAILER" | "SUPPLIER"
  businessName: string
  registrationNumber?: string
  kraPin?: string
  businessType?: string
  industry?: string
  physicalAddress?: string
  contactName?: string
  email?: string
  phoneNumber?: string
  settlementMethod?: string
  settlementAccount?: string
  posSystem?: string
  webhookUrl?: string
  settlementPreference?: string
}
```

### UpdateOnboardingDto
```typescript
{
  // Any of the above fields, all optional
}
```

### CreateIntegrationDto
```typescript
{
  merchantId: string
  apiKey?: string
  apiSecret?: string
  environment: string
  webhookUrl?: string
  isActive: boolean
}
```

### UpdateIntegrationDto
```typescript
{
  merchantId?: string
  environment?: string
  webhookUrl?: string
  isActive?: boolean
}
```

### UpdateWebhookDto
```typescript
{
  webhookUrl: string
  events: string[]
}
```

### OnboardingResponseDto
```typescript
{
  participant: OnboardingParticipant
  integrations: Integration[]
  user?: User | null
  message?: string
  profileComplete?: boolean
}
```

### ErrorResponseDto
```typescript
{
  statusCode: number
  message: string
  timestamp: string
}
```

## Onboarding Workflow

### Step 1: Create Participant
```
POST /onbordings
{
  "participantType": "RETAILER",
  "businessName": "Sample Store",
  "email": "contact@sample.com"
}
→ Participant created with status: DRAFT
→ Message: "Onboarding created. Please register an account..."
```

### Step 2: User Registration
```
POST /auth/register-before-onboarding
{
  "username": "samplestore",
  "email": "contact@sample.com",
  "password": "secure123"
}
→ User account created
→ profileComplete: false
```

### Step 3: Complete Onboarding
```
PATCH /onbordings/:id
{
  "status": "DOCUMENTS_SUBMITTED",
  "kraPin": "A012345678",
  "registrationNumber": "REG123456"
}
→ Participant status updated
```

### Step 4: Mark as Onboarded
```
POST /auth/onboarded-register
{
  "email": "contact@sample.com"
}
→ User profileComplete: true
```

### Step 5: Generate API Keys
```
POST /onbordings/generate-keys
Headers: Authorization: Bearer <token>
→ API credentials generated
→ Keys returned in response
```

### Step 6: Configure Integration
```
POST /onbordings/:id/integrations
{
  "merchantId": "MERCHANT_123",
  "environment": "production",
  "webhookUrl": "https://api.sample.com/webhook"
}
→ Integration created
→ Participant status: VERIFIED
```

## API Key Security

- API keys are generated using secure random algorithms
- Keys are hashed before storage (one-way hashing)
- Original keys are returned only once to client
- Client must store keys securely
- Keys cannot be recovered if lost
- New keys must be generated if lost

## Webhook Configuration

Webhooks are used for real-time settlement notifications:

**Webhook Events**:
- `settlement.created` - New settlement initiated
- `settlement.completed` - Settlement processed
- `settlement.failed` - Settlement failed
- `reconciliation.ready` - Reconciliation data available
- `integration.verified` - Integration verified

**Webhook Payload**:
```json
{
  "event": "settlement.completed",
  "timestamp": "2026-06-30T12:00:00Z",
  "data": {
    "settlementId": "string",
    "amount": number,
    "currency": "string",
    "participantId": "string"
  }
}
```

## Integration with Other Modules

- **Auth Module**: Users must be authenticated to generate keys or manage integrations
- **Settlement Module**: Uses participant and integration data for processing settlements
- **Database**: Uses Prisma ORM for data persistence

## Error Handling

| Error | Status | Description |
|-------|--------|-------------|
| `ConflictException` | 409 | Duplicate merchant ID or email |
| `ForbiddenException` | 403 | User not authorized for this operation |
| `NotFoundException` | 404 | Participant or integration not found |
| `BadRequestException` | 400 | Invalid data provided |
| `InternalServerErrorException` | 500 | API key generation failed |

## Security Considerations

1. **API Credentials**: Always returned hashed in responses
2. **Webhook Authentication**: Include signature validation
3. **Email Verification**: Consider requiring email confirmation
4. **Role-Based Access**: Verify user owns the participant record
5. **Audit Logging**: Log API key generation events
6. **Encryption**: Encrypt sensitive data like settlement account numbers
7. **Rate Limiting**: Limit API key generation attempts

## Best Practices

1. Validate all participant data before status transitions
2. Implement email verification for participant creation
3. Require additional verification for sensitive updates
4. Log all participant status changes for audit trail
5. Implement soft deletes for compliance/historical records
6. Use separate API keys per environment (prod/staging)
7. Rotate API keys periodically
8. Implement webhook retry logic with exponential backoff
9. Validate webhook URLs before saving
10. Monitor webhook delivery failures

## Future Enhancements

- Email verification for participant contacts
- Document upload and validation system
- Enhanced KYC/KYB verification workflow
- Settlement reconciliation reports
- Multi-language support for participant data
- Bulk participant import/export
- Integration templates for common platforms
- Real-time settlement tracking dashboard
- Automated compliance checks

---

**Module Path**: `src/onbordings/`  
**Controller Route**: `/onbordings`  
**Key Dependencies**: Prisma ORM, crypto, validator
