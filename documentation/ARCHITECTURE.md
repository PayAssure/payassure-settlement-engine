# Architecture Overview

## System Architecture

The Payassure Settlement Engine is built using a modular, layered architecture with NestJS. This document provides a high-level overview of how all components interact.

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Client Applications                  │
│              (Web, Mobile, Partner APIs)                │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ HTTP/REST
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   NestJS Application                    │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Global Middleware                     │ │
│  │  (CORS, Body Parser, Error Handling, Logging)     │ │
│  └────────────────────────────────────────────────────┘ │
│                       │                                 │
│  ┌────────────────────────────────────────────────────┐ │
│  │            Router / Route Handlers                │ │
│  │  ┌──────────────┬──────────────┬──────────────┐   │ │
│  │  │ Auth Module  │ Onbordings   │ Settlement   │   │ │
│  │  │              │ Module       │ Module       │   │ │
│  │  │ /auth        │ /onbordings  │ /settlement  │   │ │
│  │  └──────────────┴──────────────┴──────────────┘   │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │           Health Module                      │ │ │
│  │  │           /payassure/health                  │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
│                       │                                 │
│  ┌────────────────────────────────────────────────────┐ │
│  │         Controllers & Services Layer              │ │
│  │  ┌──────────────┬──────────────┬──────────────┐   │ │
│  │  │AuthService   │Onbordings    │Settlement    │   │ │
│  │  │AuthRepository│Service       │Service       │   │ │
│  │  │              │Repository    │Repository    │   │ │
│  │  └──────────────┴──────────────┴──────────────┘   │ │
│  └────────────────────────────────────────────────────┘ │
│                       │                                 │
│  ┌────────────────────────────────────────────────────┐ │
│  │     Authentication & Authorization Layer          │ │
│  │  ┌──────────────┬──────────────────────────────┐  │ │
│  │  │ JWT Strategy │      JwtAuthGuard            │  │ │
│  │  │              │  (Passport.js)              │  │ │
│  │  └──────────────┴──────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────┘ │
│                       │                                 │
│  ┌────────────────────────────────────────────────────┐ │
│  │          Data Access Layer (Prisma ORM)          │ │
│  │     Repositories & Database Queries               │ │
│  └────────────────────────────────────────────────────┘ │
└───────────────────┬──────────────────────────────────────┘
                    │
        ┌───────────┴────────────┐
        │                        │
        ▼                        ▼
   ┌─────────────────┐    ┌──────────────────┐
   │ PostgreSQL      │    │ External Services│
   │ Database        │    │ (Webhooks, etc)  │
   └─────────────────┘    └──────────────────┘
```

## Layered Architecture

### 1. Presentation Layer (Controllers)

**Responsibility**: Handle HTTP requests and responses

**Components**:
- `AuthController` - Authentication endpoints
- `OnbordingsController` - Onboarding endpoints
- `SettlementController` - Settlement endpoints
- `HealthController` - Health check endpoint

**Characteristics**:
- Accepts HTTP requests
- Validates request parameters
- Calls service layer
- Returns formatted responses
- Handles error responses

**Interaction**:
```
HTTP Request → Controller → Service → Repository → Database
```

### 2. Business Logic Layer (Services)

**Responsibility**: Implement business rules and orchestrate operations

**Components**:
- `AuthService` - User auth logic
- `OnbordingsService` - Onboarding workflows
- `SettlementService` - Settlement processing

**Characteristics**:
- No HTTP concerns
- No database queries (delegates to repository)
- Implements business rules
- Handles exceptions
- Coordinates across repositories

**Example Service Flow**:
```typescript
// Controller calls
const result = await this.authService.login(email, password);

// Service implements
// 1. Validates credentials
// 2. Generates tokens
// 3. Logs action
// 4. Returns result
```

### 3. Data Access Layer (Repositories)

**Responsibility**: Encapsulate database operations

**Components**:
- `AuthRepository` - User queries
- `OnbordingsRepository` - Participant queries
- `SettlementRepository` - Settlement queries

**Characteristics**:
- Only place where Prisma is used
- Handles database queries
- Returns domain objects
- No business logic
- Reusable across services

**Repository Pattern**:
```typescript
// Service calls repository
const user = await this.authRepository.findByEmail(email);

// Repository queries database
const user = await prisma.user.findUnique({
  where: { email },
});
```

### 4. Authentication & Authorization Layer

**Responsibility**: Protect routes and validate permissions

**Components**:
- `JwtAuthGuard` - Route protection
- `JwtStrategy` - Token validation
- `RoleGuard` (planned) - Role-based access

**Characteristics**:
- Intercepts requests
- Validates JWT tokens
- Extracts user information
- Enforces permissions
- Returns 401/403 on failure

**Guard Usage**:
```typescript
@UseGuards(JwtAuthGuard)
async protectedEndpoint(@Request() req) {
  // req.user populated by guard
  const userId = req.user.id;
}
```

## Module Architecture

Each module follows a consistent structure:

```
src/module-name/
├── module-name.module.ts      # Module configuration
├── module-name.controller.ts  # HTTP handlers
├── module-name.service.ts     # Business logic
├── module-name.repository.ts  # Data access
├── dto/                       # Data transfer objects
│   ├── create-*.dto.ts
│   ├── update-*.dto.ts
│   └── response.dto.ts
└── entities/                  # Domain entities/interfaces
    └── entity.entity.ts
```

### Module Dependency Injection

```typescript
@Module({
  controllers: [OnbordingsController],
  providers: [OnbordingsService, OnbordingsRepository],
  exports: [OnbordingsService],  // Export for other modules
})
export class OnbordingsModule {}
```

**Dependency Resolution**:
```
Controller → Service → Repository → Database
      ↑          ↑          ↑
      └─ Injected by NestJS DI container
```

## Data Flow Example: Create Participant

```
1. CLIENT
   └─ POST /onbordings { businessName, email, ... }

2. CONTROLLER
   └─ OnbordingsController.create(body)
   └─ Validates request body

3. SERVICE
   └─ OnbordingsService.createParticipant(body)
   └─ Implements business logic:
      ├─ Check if user exists
      ├─ Check if participant exists
      └─ Create new participant

4. REPOSITORY
   └─ OnbordingsRepository.createParticipantWithoutIntegration()
   └─ Executes Prisma query

5. DATABASE
   └─ PostgreSQL INSERT operation

6. RESPONSE
   └─ Created participant object
   └─ HTTP 201 response
   └─ Return to client
```

## Authentication & Authorization Flow

```
1. USER REGISTRATION
   POST /auth/register-before-onboarding
   { username, email, password }
   
2. AUTHSERVICE
   ├─ Validate input
   ├─ Hash password (bcrypt)
   └─ Create user in database
   
3. USER LOGIN
   POST /auth/login
   { email, password }
   
4. AUTHSERVICE
   ├─ Find user by email
   ├─ Verify password hash
   ├─ Generate JWT token
   ├─ Generate refresh token
   └─ Return both tokens
   
5. AUTHENTICATED REQUESTS
   GET /onbordings
   Headers: { Authorization: "Bearer eyJhbG..." }
   
6. JWTAUTHGUARD
   ├─ Extract token from header
   ├─ Validate signature
   ├─ Decode payload
   └─ Attach user to request
   
7. CONTROLLER
   ├─ Access req.user
   └─ Execute protected logic
```

## Module Interactions

### Auth ↔ Onbordings
- Auth registers users before onboarding
- Onbordings finds user by email
- Both modules share user information

### Onbordings ↔ Settlement
- Settlement uses participant data
- Uses integration configuration
- Accesses settlement preferences

### All Modules ↔ Auth
- All protected endpoints use JwtAuthGuard
- Validate user has necessary permissions
- Extract user context from token

```
         ┌──────────────┐
         │  Auth Module │
         └──────┬───────┘
                │
         ┌──────┴───────┐
         │              │
    ┌────▼────┐    ┌────▼─────────┐
    │Onbordings│    │ Settlement   │
    │ Module   │    │  Module      │
    └──────────┘    └──────────────┘
         │              │
         └──────┬───────┘
                │
         ┌──────▼───────┐
         │ Health Module│
         └──────────────┘
```

## Error Handling Architecture

### Error Flow

```
Error Occurs
    ↓
Service throws exception
    ↓
Controller catches or lets NestJS handle
    ↓
Global Exception Filter
    ↓
Format error response
    ↓
Return HTTP error
```

### Exception Types

| Exception | Status | Use Case |
|-----------|--------|----------|
| `BadRequestException` | 400 | Invalid input |
| `UnauthorizedException` | 401 | Missing/invalid token |
| `ForbiddenException` | 403 | Insufficient permissions |
| `NotFoundException` | 404 | Resource not found |
| `ConflictException` | 409 | Resource already exists |
| `InternalServerErrorException` | 500 | Unexpected error |

## Dependency Injection Container

NestJS manages all dependencies:

```typescript
// Service depends on repository
@Injectable()
export class OnbordingsService {
  constructor(private readonly repo: OnbordingsRepository) {}
  // Repository automatically injected
}

// Controller depends on service
@Controller()
export class OnbordingsController {
  constructor(private readonly service: OnbordingsService) {}
  // Service automatically injected
}

// Module provides dependencies
@Module({
  providers: [OnbordingsService, OnbordingsRepository],
  controllers: [OnbordingsController],
})
```

## Request-Response Cycle

```
1. HTTP Request arrives
           ↓
2. Global middleware processes
           ↓
3. Router matches route
           ↓
4. Guards execute (JwtAuthGuard, etc.)
           ↓
5. Pipes validate (ValidationPipe, etc.)
           ↓
6. Controller method executes
           ↓
7. Service processes business logic
           ↓
8. Repository queries database
           ↓
9. Response bubbles back up
           ↓
10. Interceptors can transform response
           ↓
11. HTTP Response sent to client
```

## Scalability Considerations

### Current Design
- Single application instance
- No horizontal scaling (requires load balancer)
- In-memory state not shared across instances

### For Production Scaling

1. **Stateless Application**
   - No session data in memory
   - Use token-based authentication (JWT) ✓
   - Database as single source of truth ✓

2. **Load Balancing**
   - Deploy multiple instances
   - Use load balancer (Nginx, AWS ALB)
   - Route requests round-robin

3. **Database**
   - Use managed database service
   - Connection pooling with PgBouncer
   - Read replicas for scaling reads

4. **Caching**
   - Add Redis for frequently accessed data
   - Cache user roles, participant status
   - Invalidate on updates

5. **Asynchronous Processing**
   - Use message queues (RabbitMQ, AWS SQS)
   - Offload long-running tasks
   - Send emails, generate reports async

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 16+ |
| Framework | NestJS 10 |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Authentication | JWT + Passport.js |
| Password Hashing | bcrypt |
| Validation | class-validator |
| API Docs | Swagger/OpenAPI |
| Testing | Jest (recommended) |

## Development Workflow

```
1. Developer creates feature
       ↓
2. Write tests
       ↓
3. Implement in service/controller
       ↓
4. Update DTOs and entities
       ↓
5. Add/update migrations if schema changed
       ↓
6. Test manually with HTTP client
       ↓
7. Create pull request
       ↓
8. Code review
       ↓
9. Merge to main
       ↓
10. Deploy to staging
       ↓
11. Deploy to production
```

## Testing Architecture (Recommended)

### Test Pyramid

```
        ▲
       ╱ ╲     E2E Tests (5%)
      ╱   ╲
     ╱─────╲   Integration Tests (15%)
    ╱       ╲
   ╱─────────╲ Unit Tests (80%)
  ╱           ╲
 ╱─────────────╲
```

### Unit Testing
- Test individual services
- Mock repositories
- Test business logic

### Integration Testing
- Test service + repository
- Use test database
- Test database interactions

### E2E Testing
- Full API testing
- HTTP requests to controllers
- Real database or test database

## Monitoring & Observability

### Logging Architecture

```
Application
    ↓
Logger Service
    ↓
┌─────────────┬──────────────┬─────────────┐
│             │              │             │
Console    File         External Service
(Dev)     (Prod)    (Datadog, ELK, etc)
```

### Metrics to Monitor

1. **Application Metrics**
   - Request count per endpoint
   - Response time distribution
   - Error rate

2. **Database Metrics**
   - Query execution time
   - Connection pool usage
   - Slow queries

3. **System Metrics**
   - CPU usage
   - Memory usage
   - Disk I/O
   - Network I/O

## Security Architecture

### Defense Layers

```
1. Input Validation
   └─ class-validator ensures data matches schema

2. Authentication
   └─ JWT tokens validate user identity

3. Authorization
   └─ Guards check user has required role

4. Data Protection
   └─ Passwords hashed with bcrypt
   └─ API keys hashed and encrypted
   └─ Sensitive data not logged

5. Transport Security
   └─ HTTPS in production
   └─ SSL/TLS certificates
   └─ Secure headers
```

## Deployment Architecture

```
┌─────────────────────────────────────────┐
│        Load Balancer (AWS ALB)         │
└──────────┬──────────────────┬───────────┘
           │                  │
    ┌──────▼────┐      ┌──────▼────┐
    │ Instance 1│      │ Instance 2 │
    │ NestJS App│      │ NestJS App │
    └──────┬────┘      └──────┬────┘
           │                  │
           └──────────┬───────┘
                      │
           ┌──────────▼──────────┐
           │ RDS PostgreSQL      │
           │ (Managed Database)  │
           └─────────────────────┘
```

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-30  
**Architecture Pattern**: Layered Architecture with Dependency Injection  
**Scalability**: Stateless, ready for horizontal scaling
