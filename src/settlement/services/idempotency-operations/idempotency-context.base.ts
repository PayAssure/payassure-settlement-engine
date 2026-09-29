import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

export abstract class IdempotencyContextBase {
  protected abstract readonly prisma: PrismaClient;
  protected abstract readonly logger: Logger;
}
