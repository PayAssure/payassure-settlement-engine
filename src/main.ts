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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
    next();
  });

  const config = new DocumentBuilder()
    .setTitle('Settlement Engine')
    .setDescription('Settlement module API')
    .setVersion('0.1')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT access token to authenticate protected endpoints.',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    include: [SettlementModule, OnbordingsModule, AuthModule],
  });
  SwaggerModule.setup('api', app, document);

  await bootstrapSuperAdmin();

  await app.listen(3000);
  console.log('Listening on http://localhost:3000');
}

bootstrap();
