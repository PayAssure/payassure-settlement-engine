import type { PrismaClient } from '@prisma/client';

export abstract class AuthRepositoryContextBase {
  protected abstract readonly prisma: PrismaClient;
}
