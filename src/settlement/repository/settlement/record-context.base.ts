import { PrismaClient } from '@prisma/client';

export abstract class SettlementRecordContextBase {
  constructor(protected readonly prisma: PrismaClient) {}
}
