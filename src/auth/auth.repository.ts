import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthRepositoryLifecycleBase } from './repository/lifecycle.base';

@Injectable()
export class AuthRepository extends AuthRepositoryLifecycleBase implements OnModuleDestroy {
  protected readonly prisma = new PrismaClient();
}
