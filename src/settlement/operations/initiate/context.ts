import type { InitiateSettlementDto } from '../../dto/initiate-settlement.dto';

export interface SettlementInitiationContext {
  prisma: any;
  repository: any;
  logger: any;
  data: InitiateSettlementDto;
  session: any;
  businessId: string;
  integrationId: string;
  retailerMerchantId: string;
  primarySettlement: any;
  allocateCashSettlement?: (data: { merchantTransactionReference: string }) => Promise<any>;
}