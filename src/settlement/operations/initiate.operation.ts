import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus, ParticipantType } from '@prisma/client';
import { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import { validateAndGetSession } from '../helpers/session.helpers';
import { validateSettlementData } from '../helpers/validation.helpers';
import { generateInternalMerchantTransactionReference, generatePayAssureReference } from '../helpers/reference.helpers';

export async function initiateOperation(
  prisma: any,
  repository: any,
  logger: any,
  token: string,
  data: InitiateSettlementDto,
  supportedCurrencies: string[],
) {
  logger.log(`Initiate settlement requested: session=${token}, merchantTransactionReference=${data.merchantTransactionReference}`);
  const session = await validateAndGetSession(token, repository, logger);
  const integration = await repository.findIntegrationById(session.integrationId);
  const businessId = (session as any).businessId ?? (session as any).business?.id ?? integration?.participantId ?? integration?.participant?.id ?? 'unknown';
  const integrationId = (session as any).integrationId ?? (session as any).integration?.id ?? integration?.id ?? 'unknown';
  logger.log(`Settlement session validated for business=${businessId}, integration=${integrationId}`);
  if (!integration || !integration.participant) {
    logger.warn(`Invalid session context: session=${token}, integrationId=${session.integrationId}`);
    throw new UnauthorizedException({ statusCode: 401, message: 'Invalid session or retailer context', error: 'INVALID_SESSION' });
  }

  const retailerMerchantId = integration.merchantId;
  logger.log(`Authenticated retailer merchantId=${retailerMerchantId}, participant=${integration.participant.id}`);

  if (integration.participant.participantType !== ParticipantType.RETAILER || !([ParticipantStatus.ACTIVE, ParticipantStatus.LIVE] as ParticipantStatus[]).includes(integration.participant.status)) {
    logger.warn(`Retailer not authorized or inactive: merchantId=${retailerMerchantId}, status=${integration.participant.status}`);
    throw new ForbiddenException({ statusCode: 403, message: 'Retailer account is not authorized to initiate settlements', error: 'RETAILER_NOT_AUTHORIZED' });
  }

  try {
    logger.log(`Checking for existing settlement for business=${businessId}, reference=${data.merchantTransactionReference}`);
    const existingSettlement = await repository.findSettlementByBusinessAndPayloadReference(businessId, data.merchantTransactionReference);
    if (existingSettlement) {
      logger.log(`Existing settlement found for reference=${data.merchantTransactionReference}, settlementId=${existingSettlement.id}`);
      await repository.markSessionAsUsed(session.id);
      return {
        success: true,
        settlement: {
          settlementId: existingSettlement.id,
          status: existingSettlement.status,
          amount: Number(existingSettlement.amount),
          currency: existingSettlement.currency,
          reference: existingSettlement.reference,
          createdAt: existingSettlement.createdAt,
          estimatedProcessingTime: '10 minutes',
          transactions: existingSettlement.transactions.map((txn: any) => ({
            transactionId: txn.id,
            itemId: txn.itemId,
            type: txn.type,
            amount: Number(txn.amount),
            description: txn.description ?? undefined,
            status: txn.status,
          })),
        },
        message: 'Settlement already processed for this merchant transaction reference',
      };
    }

    logger.log(`No existing settlement found, validating request payload for merchantTransactionReference=${data.merchantTransactionReference}`);
    await validateSettlementData(data, repository, logger, supportedCurrencies);
    logger.log(`Payload validation passed for merchantTransactionReference=${data.merchantTransactionReference}`);

    const payAssureReference = generatePayAssureReference();
    const internalMerchantTransactionReference = generateInternalMerchantTransactionReference();
    logger.log(`Creating primary settlement with payAssureReference=${payAssureReference}, internalReference=${internalMerchantTransactionReference}`);
    const primarySettlement = await repository.createSettlement(businessId, integrationId, payAssureReference, internalMerchantTransactionReference, data);

    await repository.markSessionAsUsed(session.id);
    logger.log(`Session marked as used for sessionId=${session.id}`);

    const childSettlements: Array<{ id: string; amount: number; reference: string; supplierMerchantId: string }> = [];

    for (const supplier of data.suppliers) {
      logger.log(`Processing supplier ${supplier.supplierMerchantId} for settlement ${primarySettlement.id}`);
      const supplierAmount = supplier.items.reduce((sum: number, item: any) => sum + item.supplierAmount, 0);
      logger.log(`Supplier ${supplier.supplierMerchantId} amount=${supplierAmount}, itemCount=${supplier.items.length}`);
      const supplierMerchantTransactionReference = `${internalMerchantTransactionReference}-${supplier.supplierMerchantId}`;

      const supplierIntegration = await prisma.integration.findFirst({ where: { merchantId: supplier.supplierMerchantId, isActive: true }, include: { participant: true } });
      const paymentSnapshot = supplierIntegration?.participant?.payment ?? null;

      const settlement = await repository.createSupplierSettlement(session.businessId, session.integrationId, {
        amount: supplierAmount,
        currency: data.currency,
        settlementMethod: data.settlementMethod,
        reference: `${data.merchantTransactionReference}-${supplier.supplierMerchantId}`,
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
      });

      await repository.createMultipleTransactions(settlement.id, supplier.items.map((item: any) => ({
        itemId: item.itemId,
        supplierMerchantId: supplier.supplierMerchantId,
        type: 'SALE',
        amount: item.supplierAmount,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        description: item.description,
      })));

      logger.log(`Created supplier settlement ${settlement.id} for supplier ${supplier.supplierMerchantId}`);
      childSettlements.push({ id: settlement.id, amount: supplierAmount, reference: settlement.reference, supplierMerchantId: supplier.supplierMerchantId });
    }

    return {
      success: true,
      settlement: {
        settlementId: primarySettlement.id,
        status: primarySettlement.status,
        amount: Number(primarySettlement.amount),
        currency: primarySettlement.currency,
        reference: primarySettlement.reference,
        createdAt: primarySettlement.createdAt,
        estimatedProcessingTime: '24-48 hours',
      },
      message: 'Settlement request received and queued for processing',
      children: childSettlements,
    };
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException) {
      throw error;
    }

    const err = error as Error;
    logger.error(`Settlement initiation failed: ${err.message ?? 'Unknown error'} | context=${JSON.stringify({ requestBody: data, settlementSessionToken: token })}`, err.stack);
    logger.log(`Settlement initiation flow ended with error for merchantTransactionReference=${data.merchantTransactionReference}`);
    throw new InternalServerErrorException({ statusCode: 500, message: 'An error occurred while initiating settlement. Please check logs for details.', error: 'INITIATION_FAILED' });
  }
}
