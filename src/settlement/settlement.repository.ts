import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SessionRepository } from './repository/session/session.repository';
import { IntegrationRepository } from './repository/integration/integration.repository';
import { SettlementRecordRepository } from './repository/settlement/settlement.repository';
import { TransactionRepository } from './repository/transaction/transaction.repository';
import { SettlementRepositoryLifecycleBase } from './repository-facade/lifecycle.base';

@Injectable()
export class SettlementRepository extends SettlementRepositoryLifecycleBase implements OnModuleDestroy {
  protected readonly prisma = new PrismaClient();
  readonly sessions = new SessionRepository(this.prisma);
  readonly integrations = new IntegrationRepository(this.prisma);
  readonly settlements = new SettlementRecordRepository(this.prisma);
  readonly transactions = new TransactionRepository(this.prisma);
}
