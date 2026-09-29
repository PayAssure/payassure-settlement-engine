import { Settlement, Transaction } from '@prisma/client';
import { SettlementCreateBase } from './settlement-create.base';

export abstract class SettlementReferenceLookupsBase extends SettlementCreateBase {
  async findSettlementByReference(reference: string): Promise<(Settlement & { transactions: Transaction[] }) | null> {
    const normalizedReference = String(reference ?? '').trim();
    if (!normalizedReference) return null;
    const strippedPaySuffix = normalizedReference.replace(/-pay_[^-]+$/i, '');
    const strippedTextSuffix = normalizedReference.replace(/-pay-[^-]+$/i, '');
    const strippedPrefixTxn = normalizedReference.replace(/^TXN-/, '');
    const strippedPrefixPastl = normalizedReference.replace(/^PASTL-/, '');
    const firstThreeParts = normalizedReference.split('-').slice(0, 3).join('-');
    const candidates = [normalizedReference, strippedPaySuffix, strippedTextSuffix, strippedPrefixTxn, strippedPrefixPastl, firstThreeParts].filter(Boolean);
    const metadataLookupFields = [
      'payoutReference', 'latestPayoutReference', 'lastPayoutCallback.reference', 'originalMerchantReference',
      'parentMerchantTransactionReference', 'merchantTransactionReference', 'callbackIdentifier', 'callbackToken', 'callbackUrl',
    ];
    const uniqueCandidates = Array.from(new Set(candidates));
    for (const candidate of uniqueCandidates) {
      const settlement = await this.prisma.settlement.findFirst({
        where: {
          OR: [
            { reference: candidate },
            { merchantTransactionReference: candidate },
            { metadata: { path: ['originalMerchantReference'], equals: candidate } },
            { metadata: { path: ['parentMerchantTransactionReference'], equals: candidate } },
            { metadata: { path: ['payoutReference'], equals: candidate } },
            { metadata: { path: ['latestPayoutReference'], equals: candidate } },
            { metadata: { path: ['lastPayoutCallback', 'reference'], equals: candidate } },
            { metadata: { path: ['callbackIdentifier'], equals: candidate } },
            { metadata: { path: ['callbackToken'], equals: candidate } },
            { metadata: { path: ['callbackUrl'], equals: candidate } },
            { paymentPayload: { path: ['merchantTransactionReference'], equals: candidate } },
            ...(metadataLookupFields.includes('merchantTransactionReference') ? [{ metadata: { path: ['merchantTransactionReference'], equals: candidate } }] : []),
          ],
        },
        include: { transactions: true },
      });
      if (settlement) return settlement;
    }
    return null;
  }

  async findSettlementByPayoutCallbackIdentifier(callbackIdentifier: string): Promise<(Settlement & { transactions: Transaction[] }) | null> {
    const normalizedId = String(callbackIdentifier ?? '').trim();
    if (!normalizedId) return null;
    const matchesCallbackId = (value: any): boolean => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some((item) => matchesCallbackId(item));
      if (value.callbackIdentifier === normalizedId || value.callbackToken === normalizedId) return true;
      for (const nestedValue of Object.values(value)) {
        if (matchesCallbackId(nestedValue)) return true;
      }
      return false;
    };
    const allSettlements = await this.prisma.settlement.findMany({
      include: { transactions: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    for (const settlement of allSettlements) {
      const metadata = settlement.metadata as any;
      if (metadata && matchesCallbackId(metadata)) return settlement;
    }
    return null;
  }
}
