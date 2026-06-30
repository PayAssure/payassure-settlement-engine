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
  console.log('Listening on http://localhost:3000');
}

bootstrap();
