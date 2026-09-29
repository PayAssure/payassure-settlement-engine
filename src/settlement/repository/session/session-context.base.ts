import { PrismaClient } from '@prisma/client';

export abstract class SessionContextBase {
  constructor(protected readonly prisma: PrismaClient) {}
}
