import { createHmac, randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export type SettlementWebhookEvent =
  | 'payment.collection.succeeded'
  | 'payment.collection.failed'
  | 'payment.settlement.started'
  | 'payment.settlement.progress'
  | 'payment.settlement.partially_failed'
  | 'payment.settlement.retrying'
  | 'payment.settlement.completed'
  | 'payment.settlement.reconciliation_required';

type WebhookParticipant = {
  merchantId: string;
  participantType: string;
  webhookUrl: string;
  secret: string;
};

export class SettlementWebhookDeliveryService {
  private readonly logger = new Logger(SettlementWebhookDeliveryService.name);

  constructor(private readonly prisma: PrismaClient) {}

  async notify(settlementId: string, eventType: SettlementWebhookEvent, details: Record<string, unknown> = {}) {
    try {
      const settlement = await this.prisma.settlement.findUnique({
        where: { id: settlementId },
        include: { transactions: { select: { supplierMerchantId: true } } },
      });
      if (!settlement) {
        this.logger.error(`Cannot deliver ${eventType}: settlement ${settlementId} was not found`);
        return;
      }

      const paymentPayload = this.asRecord(settlement.paymentPayload);
      const supplierIds = new Set<string>(
        (Array.isArray(paymentPayload.suppliers) ? paymentPayload.suppliers : [])
          .map((supplier) => this.asRecord(supplier).supplierMerchantId)
          .filter((merchantId): merchantId is string => typeof merchantId === 'string' && merchantId.length > 0),
      );
      for (const transaction of settlement.transactions) {
        if (transaction.supplierMerchantId) supplierIds.add(transaction.supplierMerchantId);
      }
      const participants = await this.resolveParticipants(settlement, [...supplierIds]);
      if (participants.length === 0) {
        this.logger.warn(`No configured webhook endpoint found for ${eventType} on settlement ${settlementId}`);
        return;
      }

      const payoutAttempts = await this.prisma.b2BPayoutAttempt.findMany({
        where: { settlementId },
        select: {
          party: true,
          recipientMerchantId: true,
          amount: true,
          status: true,
          payoutReference: true,
          updatedAt: true,
        },
      });
      const eventId = randomUUID();
      const createdAt = new Date().toISOString();
      const baseData = {
        settlement: {
          id: settlement.id,
          reference: settlement.reference,
          merchant_transaction_reference: settlement.merchantTransactionReference,
          amount: Number(settlement.amount),
          currency: settlement.currency,
          status: settlement.status,
        },
        details,
      };
      await Promise.all(participants.map((participant) => {
        const visiblePayouts = participant.participantType === 'SUPPLIER'
          ? payoutAttempts.filter((attempt) => attempt.recipientMerchantId === participant.merchantId)
          : payoutAttempts;
        const body = JSON.stringify({
          id: eventId,
          type: eventType,
          created_at: createdAt,
          data: {
            ...baseData,
            recipient: {
              merchant_id: participant.merchantId,
              participant_type: participant.participantType,
            },
            payouts: visiblePayouts.map((attempt) => ({
              party: attempt.party,
              merchant_id: attempt.recipientMerchantId,
              amount: Number(attempt.amount),
              status: attempt.status,
              reference: attempt.payoutReference,
              updated_at: attempt.updatedAt.toISOString(),
            })),
          },
        });
        return this.deliver(participant, eventId, eventType, body);
      }));
    } catch (error) {
      this.logger.error(
        `Webhook event ${eventType} could not be prepared for settlement ${settlementId}`,
        this.errorMessage(error),
      );
    }
  }

  private async resolveParticipants(
    settlement: { businessId: string; integrationId: string; paymentPayload: unknown },
    supplierMerchantIds: string[],
  ): Promise<WebhookParticipant[]> {
    const retailerIntegration = await this.prisma.integration.findUnique({
      where: { id: settlement.integrationId },
      include: { participant: true },
    });
    const retailerParticipant = retailerIntegration?.participant
      ?? await this.prisma.onboardingParticipant.findUnique({ where: { id: settlement.businessId } });
    const participants = new Map<string, WebhookParticipant>();
    if (retailerParticipant) {
      const integration = retailerIntegration?.participantId === retailerParticipant.id
        ? retailerIntegration
        : await this.prisma.integration.findFirst({
          where: { participantId: retailerParticipant.id, isActive: true },
          orderBy: { createdAt: 'desc' },
        });
      this.addParticipant(participants, integration, retailerParticipant);
    }

    if (supplierMerchantIds.length > 0) {
      const integrations = await this.prisma.integration.findMany({
        where: { merchantId: { in: supplierMerchantIds }, isActive: true },
        include: { participant: true },
      });
      for (const integration of integrations) {
        this.addParticipant(participants, integration, integration.participant);
      }
    }
    return [...participants.values()];
  }

  private addParticipant(
    participants: Map<string, WebhookParticipant>,
    integration: {
      merchantId: string;
      apiSecret: string | null;
      webhookUrl: string | null;
    } | null,
    participant: {
      id: string;
      participantType: string;
      webhookUrl: string | null;
    } | null,
  ) {
    if (!participant) return;
    const webhookUrl = integration?.webhookUrl ?? participant.webhookUrl;
    if (!webhookUrl) return;
    if (!integration?.apiSecret) {
      this.logger.error(`Webhook for participant ${participant.id} is configured without an integration signing secret`);
      return;
    }
    participants.set(participant.id, {
      merchantId: integration.merchantId,
      participantType: participant.participantType,
      webhookUrl,
      secret: integration.apiSecret,
    });
  }

  private async deliver(
    participant: WebhookParticipant,
    eventId: string,
    eventType: SettlementWebhookEvent,
    body: string,
  ) {
    let url: URL;
    try {
      url = new URL(participant.webhookUrl);
    } catch (error) {
      this.logger.warn(`Invalid webhook URL for merchant ${participant.merchantId}`, this.errorMessage(error));
      return;
    }
    if (url.protocol !== 'https:') {
      this.logger.warn(`Refusing non-HTTPS webhook URL for merchant ${participant.merchantId}`);
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', participant.secret).update(`${timestamp}.${body}`).digest('hex');
    const headers = {
      'content-type': 'application/json',
      'x-payassure-event': eventType,
      'x-payassure-event-id': eventId,
      'x-payassure-timestamp': timestamp,
      'x-payassure-signature': `t=${timestamp},v1=${signature}`,
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
          redirect: 'error',
        });
        await response.body?.cancel();
        if (!response.ok) {
          throw new Error(`Webhook returned HTTP ${response.status}`);
        }
        return;
      } catch (error) {
        if (attempt === 3) {
          this.logger.error(
            `Webhook delivery failed for merchant ${participant.merchantId}, event ${eventId} (${eventType}) after ${attempt} attempts`,
            this.errorMessage(error),
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** (attempt - 1))));
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private asRecord(value: unknown): Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {};
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
