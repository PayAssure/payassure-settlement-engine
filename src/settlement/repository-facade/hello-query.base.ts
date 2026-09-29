import type { Hello } from '@prisma/client';
import { SettlementRepositoryContextBase } from './repository-context.base';

export abstract class SettlementHelloQueryBase extends SettlementRepositoryContextBase {
  async findFirstHello(): Promise<Hello | null> {
    return this.prisma.hello.findFirst();
  }
}
