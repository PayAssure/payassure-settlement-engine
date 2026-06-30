# Auth Module Documentation

## Overview

The Auth Module handles all authentication and authorization operations for the Payassure Settlement Engine. It manages user registration, login, token generation, and access control through JWT (JSON Web Token) authentication.

**Location**: `src/auth/`

## Features

- **User Registration** - Multiple registration flows for different user types
- **Login** - Authenticate users and generate JWT tokens
- **Token Management** - Access token and refresh token handling
- **Role-Based Access Control** - Support for SUPER_ADMIN, ADMIN, and USER roles
- **JWT Strategy** - Passport.js JWT strategy for route protection
- **Password Security** - bcrypt hashing for secure password storage

## Core Components

### 1. AuthController (`auth.controller.ts`)

Main entry point for authentication endpoints.

**Endpoints**:

#### POST `/auth/register`
- **Description**: Register a new admin user
- **Auth Required**: Yes (Bearer Token)
- **Admin Only**: Yes (SUPER_ADMIN required)
- **Body**:
  ```json
  {
    "username": "string",
    "email": "string",
    "password": "string"
  }
  ```
- **Returns**: `RegisterResponseDto`

#### POST `/auth/register-before-onboarding`
- **Description**: Create a user account before onboarding is completed
- **Auth Required**: No
- **Body**:
  ```json
  {
    "username": "string",
    "email": "string",
    "password": "string"
  }
  ```
- **Returns**: `RegisterResponseDto`
- **Status**: `profileComplete: false` - User must complete onboarding

#### POST `/auth/onboarded-register`
- **Description**: Register a user after onboarding or mark existing user as onboarded
- **Auth Required**: No
- **Body**:
  ```json
  {
    "email": "string"
  }
  ```
- **Returns**: `RegisterResponseDto`
- **Status**: `profileComplete: true`

#### POST `/auth/login`
- **Description**: Authenticate user and retrieve tokens
- **Auth Required**: No
- **Body**:
  ```json
  {
    "email": "string",
    "password": "string"
  }
  ```
- **Returns**: 
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "user": {
      "id": "string",
      "email": "string",
      "username": "string",
      "role": "USER|ADMIN|SUPER_ADMIN"
    }
  }
  ```

#### POST `/auth/refresh-token`
- **Description**: Refresh an expired access token
- **Auth Required**: No
- **Body**:
  ```json
  {
    "refreshToken": "string"
  }
  ```
- **Returns**: `AuthResponseDto` with new tokens

#### GET `/auth/users`
- **Description**: List all users with optional filtering
- **Auth Required**: Yes (Bearer Token)
- **Query Parameters**:
  - `skip`: number (pagination)
  - `take`: number (pagination)
  - `role`: "SUPER_ADMIN" | "ADMIN" | "USER" (optional filter)
- **Returns**: `GetUsersResponseDto[]`

#### DELETE `/auth/users/:id`
- **Description**: Deactivate a user account
- **Auth Required**: Yes (Bearer Token)
- **Admin Only**: Yes
- **Returns**: `{ message: string }`

### 2. AuthService (`auth.service.ts`)

Core business logic for authentication operations.

**Key Methods**:

#### `registerAdmin(data: RegisterAdminDto, actor: any): Promise<RegisterResponseDto>`
- Validates that the requesting user is a SUPER_ADMIN
- Creates a new ADMIN user in the system
- Throws `ForbiddenException` if not authorized

#### `registerBeforeOnboarding(data: RegisterDto): Promise<RegisterResponseDto>`
- Allows users to register before completing onboarding
- Returns message: "Account created successfully. Your profile is incomplete. Please complete onboarding to finish setup."
- Sets `profileComplete: false`

#### `registerAfterOnboarding(email: string): Promise<RegisterResponseDto>`
- Marks an existing incomplete profile as complete
- Sets `profileComplete: true`

#### `login(email: string, password: string): Promise<AuthResponseDto>`
- Validates email and password
- Generates JWT access token (short-lived)
- Generates refresh token (long-lived)
- Increments `refreshTokenVersion` for token invalidation

#### `refreshToken(refreshToken: string): Promise<AuthResponseDto>`
- Validates refresh token
- Generates new access token
- Returns updated tokens

#### `private createUser(...): Promise<User>`
- Helper method to create new users
- Hashes password using bcrypt
- Validates username and email uniqueness

### 3. AuthRepository (`auth.repository.ts`)

Data access layer for user operations.

**Methods**:
- `create(username, email, passwordHash, role)` - Create new user
- `findByEmail(email)` - Find user by email
- `findByUsername(username)` - Find user by username
- `findByEmailOrUsername(username, email)` - Find by either identifier
- `findById(id)` - Retrieve user by ID
- `findAll(skip, take, role?)` - List users with pagination and optional role filter
- `findOnboardedByEmail(email)` - Find onboarded user
- `updateRefreshTokenVersion(id)` - Invalidate refresh tokens by incrementing version
- `deactivateUser(id)` - Set user as inactive

### 4. JwtAuthGuard (`jwt-auth.guard.ts`)

Route protection middleware using Passport.js JWT strategy.

**Usage**:
```typescript
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
async protectedRoute(@Request() req: any) {
  // req.user contains decoded JWT payload
  const userId = req.user.id;
  const role = req.user.role;
}
```

### 5. JwtStrategy (`jwt.strategy.ts`)

Passport.js strategy implementation for JWT validation.

**Configuration**:
- Extracts token from Authorization header (Bearer scheme)
- Validates token signature using JWT_SECRET
- Returns decoded payload as `request.user`

### 6. Bootstrap (`bootstrap.ts`)

Application initialization module setup.

**Responsibilities**:
- Creates super admin user on first run if it doesn't exist
- Initializes default application roles
- Configures Passport strategies

## Data Transfer Objects (DTOs)

### RegisterAdminDto
```typescript
{
  username: string
  email: string
  password: string
}
```

### RegisterDto
```typescript
{
  username: string
  email: string
  password: string
}
```

### LoginDto
```typescript
{
  email: string
  password: string
}
```

### RefreshTokenDto
```typescript
{
  refreshToken: string
}
```

### AuthResponseDto
```typescript
{
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    username: string
    role: UserRole
  }
}
```

### RegisterResponseDto
```typescript
{
  message: string
  profileComplete: boolean
  user: {
    id: string
    username: string
    email: string
    role: UserRole
  }
}
```

### GetUsersResponseDto
```typescript
{
  id: string
  username: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: DateTime
}
```

## User Roles

| Role | Permissions |
|------|------------|
| SUPER_ADMIN | Create admin users, all admin privileges |
| ADMIN | Manage users, access admin endpoints |
| USER | Standard user privileges, access onboarding |

## Authentication Flow

### Registration Flow
```
1. User calls POST /auth/register-before-onboarding
2. AuthService.registerBeforeOnboarding() is invoked
3. Password is hashed using bcrypt
4. User is created with role: USER and profileComplete: false
5. User receives response with message to complete onboarding
```

### Login Flow
```
1. User calls POST /auth/login with email and password
2. AuthService validates credentials
3. AuthService.login() generates JWT tokens
4. Access Token: Short-lived (15 minutes)
5. Refresh Token: Long-lived, stored with refreshTokenVersion
6. User receives both tokens and user object
```

### Token Refresh Flow
```
1. Client calls POST /auth/refresh-token with refreshToken
2. AuthService.refreshToken() validates refresh token
3. Checks refreshTokenVersion hasn't changed (prevents token reuse after logout)
4. Generates new accessToken
5. Returns new tokens to client
```

### Protected Route Access
```
1. Client includes Authorization: Bearer <accessToken> header
2. JwtAuthGuard intercepts request
3. JwtStrategy validates token signature and expiry
4. If valid: req.user is populated with decoded payload
5. Route handler executes with user context
```

## Security Features

- **Password Hashing**: Passwords are hashed using bcrypt before storage
- **JWT Tokens**: Stateless authentication using signed JWT tokens
- **Token Versioning**: Refresh token version invalidates old tokens on logout
- **Bearer Authentication**: Standard Bearer scheme for token transmission
- **Role-Based Access Control**: Different access levels for different user roles
- **Endpoint Protection**: Guards prevent unauthorized access to admin endpoints

## Error Handling

| Error | Status | Description |
|-------|--------|-------------|
| `ConflictException` | 409 | Username or email already exists |
| `UnauthorizedException` | 401 | Invalid credentials or missing token |
| `ForbiddenException` | 403 | Insufficient permissions for operation |
| `NotFoundException` | 404 | User not found |

## Integration with Other Modules

- **Onbordings Module**: Users must register before completing onboarding
- **Auth Guards**: Used across all modules to protect sensitive endpoints
- **JWT Strategy**: Shared authentication mechanism across entire application

## Environment Variables Required

```
JWT_SECRET=your-secret-key
JWT_EXPIRY=900 (15 minutes in seconds)
JWT_REFRESH_EXPIRY=604800 (7 days in seconds)
```

## Best Practices

1. Always include Bearer token for protected endpoints
2. Store refresh tokens securely (httpOnly cookies recommended)
3. Implement token rotation on each refresh
4. Log out by incrementing refresh token version
5. Validate email confirmation before allowing account access
6. Implement rate limiting on login attempts
7. Keep JWT_SECRET secure and rotate periodically

---

**Module Path**: `src/auth/`  
**Controller Route**: `/auth`  
**Key Dependencies**: Passport.js, bcrypt, JWT
