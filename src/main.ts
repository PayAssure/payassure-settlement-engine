import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { OnbordingsModule } from './onbordings/onbordings.module';
import { AuthModule } from './auth/auth.module';
import { SettlementModule } from './settlement/settlement.module';
import { bootstrapSuperAdmin } from './auth/bootstrap';
import { HealthModule } from './health/health.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const corsOriginEnv =
    process.env.CORS_ORIGIN ||
    process.env.ALLOWED_ORIGIN ||
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.CORS_ALLOWED_ORIGINS ||
    '';

  const allowedOrigins = corsOriginEnv
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.length === 0) {
        callback(null, false);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-settlement-session', 'x-supplier-session', 'x-payassure-signature', 'x-payassure-timestamp'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
    next();
  });
  const config = new DocumentBuilder()
    .setTitle('PayAssure API')
    .setDescription(`
PayAssure is a secure financial integration and settlement platform that enables retailers, suppliers, financial institutions, and enterprise systems to automate payment processing, transaction orchestration, and settlement workflows.

This API provides endpoints for:
- Authentication and authorization
- Participant onboarding and management
- API integrations and webhooks
- Transaction ingestion
- Settlement processing
- Payout execution
- Reconciliation
- Reporting and analytics
- Notifications and event management

All protected endpoints require a valid JWT access token. API integrations authenticate using merchant credentials and API keys where applicable.
  `)
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Provide a valid JWT access token in the format: Bearer <access_token>.',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    include: [SettlementModule, OnbordingsModule, AuthModule,HealthModule],
  });
  SwaggerModule.setup('api', app, document);

  await bootstrapSuperAdmin();

  await app.listen(3000);
  console.log('Swagger documentation available on http://localhost:3000/api');
}

bootstrap();
