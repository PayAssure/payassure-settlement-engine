import { PrismaClient } from '@prisma/client';

export abstract class TransactionContextBase {
  constructor(protected readonly prisma: PrismaClient) {}
}
