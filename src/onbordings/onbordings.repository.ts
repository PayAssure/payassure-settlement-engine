import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { OnbordingsRepositoryLifecycleBase } from './repository-operations/lifecycle.base';

@Injectable()
export class OnbordingsRepository extends OnbordingsRepositoryLifecycleBase implements OnModuleDestroy {
  protected readonly logger = new Logger(OnbordingsRepository.name);
  protected readonly prisma = new PrismaClient();
}
