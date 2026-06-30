# Payassure Settlement Engine Documentation

This documentation provides a comprehensive guide to the Payassure Settlement Engine API, including all modules, their functionality, and how they interact with each other.

## Project Overview

The Payassure Settlement Engine is a NestJS-based backend application that handles:
- User authentication and authorization
- Onboarding of retailers and suppliers
- Integration management
- Settlement operations
- Health monitoring

## Modules

This application is organized into the following modules:

1. **[Auth Module](./AUTH_MODULE.md)** - User authentication, registration, and JWT token management
2. **[Onbordings Module](./ONBORDINGS_MODULE.md)** - Participant onboarding and integration management
3. **[Settlement Module](./SETTLEMENT_MODULE.md)** - Settlement-related operations
4. **[Health Module](./HEALTH_MODULE.md)** - Application health checks

## Additional Documentation

- **[Database Schema](./DATABASE_SCHEMA.md)** - Prisma ORM data models and relationships
- **[Architecture Overview](./ARCHITECTURE.md)** - System design and component interactions

## Tech Stack

- **Framework**: NestJS 10.0
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT with Passport.js
- **API Documentation**: Swagger/OpenAPI
- **Password Hashing**: bcrypt
- **Validation**: class-validator and class-transformer

## Quick Start

```bash
# Install dependencies
npm install

# Setup database
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed

# Start development server
npm run dev

# Build for production
npm run build
npm start
```

## API Base URL

```
http://localhost:3000
```

## Common Authentication Pattern

Most protected endpoints require a Bearer token:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/endpoint
```

---

For detailed information about each module, please refer to the individual module documentation files.
