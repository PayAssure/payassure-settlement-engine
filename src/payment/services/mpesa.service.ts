import { MpesaPayoutOperationsBase } from './mpesa-operations/payout-operations.base';

export type { MpesaRequestCredentials, PaymentRequestLog } from './mpesa-operations/types';

export class MpesaService extends MpesaPayoutOperationsBase {
  protected readonly logger = console;
}

export const mpesaService = new MpesaService();
