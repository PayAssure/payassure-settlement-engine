import type { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import { SettlementResponseDto } from '../dto/settlement-response.dto';
import { initiateOperation } from '../operations/initiate.operation';
import { SettlementAuthenticationBase } from './authentication.base';

export abstract class SettlementInitiationBase extends SettlementAuthenticationBase {
  async initiateSettlement(token: string, data: InitiateSettlementDto): Promise<SettlementResponseDto> {
    return initiateOperation(this.prisma, this.repository, this.logger, token, data, this.SUPPORTED_CURRENCIES);
  }
}
