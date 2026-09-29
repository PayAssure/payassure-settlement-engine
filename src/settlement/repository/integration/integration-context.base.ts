import { PrismaClient } from '@prisma/client';

export abstract class IntegrationContextBase {
  constructor(protected readonly prisma: PrismaClient) {}
}
