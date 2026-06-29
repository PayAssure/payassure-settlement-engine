# payassure-settlement-engine

This project is a minimal NestJS + Prisma scaffold with a `settlement` module.

Quick start:

1. Install dependencies

```bash
npm install
```

2. Configure PostgreSQL connection

Copy the example `.env` and edit the `DATABASE_URL` to point to your PostgreSQL instance:

```bash
cp prisma/.env.example prisma/.env
# or create a project root .env with DATABASE_URL
# edit prisma/.env and set your credentials
```

3. Generate Prisma client and apply migrations

```bash
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
```

4. Run in dev mode

```bash
npm run start:dev
```

Open Swagger UI at http://localhost:3000/api and call `GET /settlement/hello`.

Core settlement and reconciliation engine for the PayAssure financial platform.
