import type { PrismaClient } from '@prisma/client';
import type { SessionRepository } from '../repository/session/session.repository';
import type { IntegrationRepository } from '../repository/integration/integration.repository';
import type { SettlementRecordRepository } from '../repository/settlement/settlement.repository';
import type { TransactionRepository } from '../repository/transaction/transaction.repository';

export abstract class SettlementRepositoryContextBase {
  protected abstract readonly prisma: PrismaClient;
  protected abstract readonly sessions: SessionRepository;
  protected abstract readonly integrations: IntegrationRepository;
  protected abstract readonly settlements: SettlementRecordRepository;
  protected abstract readonly transactions: TransactionRepository;
}
