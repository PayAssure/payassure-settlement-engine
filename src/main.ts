import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

dotenv.config();
import { AppModule } from './app.module';
import { OnbordingsModule } from './onbordings/onbordings.module';
import { AuthModule } from './auth/auth.module';
import { SettlementModule } from './settlement/settlement.module';
import { bootstrapSuperAdmin } from './auth/bootstrap';
import { HealthModule } from './health/health.module';
import { PaymentModule } from './payment/payment.module';
import { EscrowIntelligenceModule } from './escrow-intelligence/escrow-intelligence.module';
import { ValidationErrorFilter } from './common/filters/validation-error.filter';
import { RequestBodyLoggingInterceptor } from './common/interceptors/request-body-logging.interceptor';

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

  app.useGlobalInterceptors(new RequestBodyLoggingInterceptor());
  app.useGlobalFilters(new ValidationErrorFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  const config = new DocumentBuilder()
    .setTitle('PayAssure Platform API')
    .setDescription(`
PayAssure is a unified platform for payment orchestration, merchant onboarding, settlement execution, reconciliation, and payout workflows.

Included modules:
- Auth and onboarding
- Payment initiation and M-Pesa operations
- Payment callback processing
- Settlement creation and confirmation
- Escrow intelligence with provider-aware reconciliation for MPESA and CASH
- Mock escrow control panel and scenario testing for development environments
- Reconciliation and payout tracking

All protected endpoints require a valid JWT access token. Internal payment confirmation requests use the configured application token and signature secret.
The CASH provider path includes escrow validation, simulated collection from retailer escrow, and supplier payout dispatch. The MPESA provider path keeps the existing STK push settlement flow.
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
    include: [SettlementModule, OnbordingsModule, AuthModule, HealthModule, PaymentModule, EscrowIntelligenceModule],
  });
  SwaggerModule.setup('api', app, document, {
    customSiteTitle: 'PayAssure API',
    customfavIcon: '',
    swaggerOptions: {
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      persistAuthorization: true,
    },
    customCss: `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info .title { font-size: 2.2rem; }
    `,
  });

  await bootstrapSuperAdmin();

  await app.listen(3000);
  console.log('Swagger documentation available on http://localhost:3000/api');
}

bootstrap();
