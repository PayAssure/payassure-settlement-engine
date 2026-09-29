import { toPublicPaymentDetails } from '../helpers/to-public-payment-details';

export async function createSupplierSettlements(context: {
  prisma: any;
  repository: any;
  logger: any;
  data: any;
  session: any;
  primarySettlement: any;
  internalMerchantTransactionReference: string;
  retailerMerchantId: string;
}) {
  const {
    prisma,
    repository,
    logger,
    data,
    session,
    primarySettlement,
    internalMerchantTransactionReference,
    retailerMerchantId,
  } = context;
  const childSettlements: Array<{
    id: string;
    reference: string;
    supplier: { amount: number; paymentDetails?: any };
    retailer: { amount: number; paymentDetails?: any };
    systemAmount: number;
    amount: number;
  }> = [];
  let totalSupplierAmount = 0;
  let totalRetailerAmount = 0;
  let totalSystemAmount = 0;
  const supplierAmountSummary: Array<{ supplierMerchantId?: string; supplierAmount: number; retailerAmount: number; platformFee: number }> = [];

  for (const [supplierIndex, supplier] of data.suppliers.entries()) {
    const supplierItems = Array.isArray(supplier.items) ? supplier.items : [];
    const hasItems = supplierItems.length > 0;
    const supplierAmount = hasItems
      ? supplierItems.reduce((sum: number, item: any) => sum + Number(item.supplierAmount ?? 0), 0)
      : Number(supplier.supplierTotalAmount ?? 0);
    const retailerAmount = Number(supplier.retailerTotalAmount ?? 0);
    const platformFee = Number(supplier.platformFee ?? 0);
    totalSupplierAmount += supplierAmount;
    totalRetailerAmount += retailerAmount;
    totalSystemAmount += platformFee;
    supplierAmountSummary.push({ supplierMerchantId: supplier.supplierMerchantId, supplierAmount, retailerAmount, platformFee });

    const supplierMerchantTransactionReference = `${internalMerchantTransactionReference}-${supplier.supplierMerchantId}-${supplierIndex}`;
    const supplierIntegration = await prisma.integration.findFirst({
      where: { merchantId: supplier.supplierMerchantId, isActive: true },
      include: { participant: true },
    });
    const paymentSnapshot = supplierIntegration?.participant?.payment ?? null;
    const supplierPaymentDetails = toPublicPaymentDetails(paymentSnapshot);

    const settlement = await repository.createSupplierSettlement(session.businessId, session.integrationId, {
      amount: supplierAmount,
      currency: data.currency,
      settlementMethod: data.settlementMethod,
      reference: `${data.merchantTransactionReference}-${supplier.supplierMerchantId}-${supplierIndex}`,
      merchantTransactionReference: supplierMerchantTransactionReference,
      description: data.description,
      metadata: {
        ...(data.metadata ?? {}),
        originalMerchantReference: data.merchantTransactionReference,
        parentSettlementId: primarySettlement.id,
        supplierMerchantId: supplier.supplierMerchantId,
        retailerMerchantId,
      },
      paymentSnapshot,
      paymentPayload: {
        paymentMethod: data.paymentMethod,
        suppliers: [{
          supplierMerchantId: supplier.supplierMerchantId,
          supplierTotalAmount: supplierAmount,
          retailerTotalAmount: retailerAmount,
          platformFee,
          items: hasItems ? supplierItems.map((item: any) => ({
            itemReference: item.itemReference ?? item.itemId,
            supplierAmount: item.supplierAmount,
          })) : [],
        }],
      },
    });

    const transactionItems = hasItems
      ? supplierItems.map((item: any) => ({
          itemId: item.itemReference ?? item.itemId ?? 'supplier-summary',
          supplierMerchantId: supplier.supplierMerchantId,
          type: 'SALE',
          amount: Number(item.supplierAmount ?? 0),
        }))
      : [{
          itemId: `${supplier.supplierMerchantId}-summary`,
          supplierMerchantId: supplier.supplierMerchantId,
          type: 'SALE',
          amount: supplierAmount,
        }];
    await repository.createMultipleTransactions(settlement.id, transactionItems);

    childSettlements.push({
      id: settlement.id,
      reference: settlement.reference,
      supplier: { amount: supplierAmount, paymentDetails: supplierPaymentDetails },
      retailer: { amount: retailerAmount, paymentDetails: toPublicPaymentDetails(data.paymentMethod) },
      systemAmount: platformFee,
      amount: supplierAmount + retailerAmount + platformFee,
    });
  }

  logger.log('[SUPPLIER_SETTLEMENT_AMOUNTS]', supplierAmountSummary);
  return { childSettlements, totalSupplierAmount, totalRetailerAmount, totalSystemAmount };
}