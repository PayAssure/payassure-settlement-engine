import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

export abstract class OnbordingsRepositoryContextBase {
  protected abstract readonly logger: Logger;
  protected abstract readonly prisma: PrismaClient;
}
