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
  integrationId: string;
  merchantId: string;
  participantType: string;
  webhookUrl: string;
  secret: string;
};

export class SettlementWebhookDeliveryService {
  private readonly logger = new Logger(SettlementWebhookDeliveryService.name);

  constructor(private readonly prisma: PrismaClient) {}

  async notify(settlementId: string, eventType: SettlementWebhookEvent, details: Record<string, unknown> = {}) {
    const settlement = await this.prisma.settlement.findUnique({ where: { id: settlementId } });
    if (!settlement) {
      throw new Error(`Cannot deliver ${eventType}: settlement ${settlementId} was not found`);
    }

    const retailer = await this.resolveRetailer(settlement);
    if (!retailer) {
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
    const cashFunding = this.cashFunding(settlement.metadata, settlement.currency);
    const body = JSON.stringify({
      id: eventId,
      type: eventType,
      created_at: createdAt,
      data: {
        settlement: {
          id: settlement.id,
          reference: settlement.reference,
          merchant_transaction_reference: settlement.merchantTransactionReference,
          merchantTransactionReference: settlement.merchantTransactionReference,
          amount: Number(settlement.amount),
          currency: settlement.currency,
          status: settlement.status,
        },
        ...(cashFunding ? { cash_funding: cashFunding } : {}),
        details,
        recipient: {
          merchant_id: retailer.merchantId,
          participant_type: retailer.participantType,
        },
        payouts: payoutAttempts.map((attempt) => ({
          party: attempt.party,
          merchant_id: attempt.recipientMerchantId,
          amount: Number(attempt.amount),
          status: attempt.status,
          reference: attempt.payoutReference,
          updated_at: attempt.updatedAt.toISOString(),
        })),
      },
    });
    const delivery = await this.prisma.settlementWebhookDelivery.create({
      data: {
        eventId,
        settlementId,
        integrationId: retailer.integrationId,
        merchantId: retailer.merchantId,
        eventType,
        endpoint: retailer.webhookUrl,
        payload: body,
        status: 'PENDING',
      },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.deliverStored(delivery.id, retailer.secret, true);
      if (result.status !== 'RETRYING') return result;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** attempt)));
    }
    return this.prisma.settlementWebhookDelivery.findUnique({ where: { id: delivery.id } });
  }

  async processPendingRetries(batchSize = 10): Promise<number> {
    try {
      const staleDeliveryBefore = new Date(Date.now() - 5 * 60 * 1000);
      await this.prisma.settlementWebhookDelivery.updateMany({
        where: { status: 'DELIVERING', lastAttemptAt: { lte: staleDeliveryBefore } },
        data: {
          status: 'RETRYING',
          nextAttemptAt: new Date(),
          lastError: 'Previous webhook delivery worker stopped before recording its outcome',
        },
      });
      const pending = await this.prisma.settlementWebhookDelivery.findMany({
        where: { status: 'RETRYING', nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: batchSize,
      });
      for (const delivery of pending) {
        await this.deliverStored(delivery.id);
      }
      return pending.length;
    } catch (error) {
      if (this.isMissingTableError(error)) {
        this.logger.warn(
          '[SETTLEMENT_WEBHOOK_DELIVERY] Skipping retry processing because the settlement webhook tables do not exist yet. Run prisma migrate deploy to create them.',
          { error: this.errorMessage(error) },
        );
        return 0;
      }
      throw error;
    }
  }

  private async resolveRetailer(
    settlement: { businessId: string; integrationId: string },
  ): Promise<WebhookParticipant | null> {
    const retailerIntegration = await this.prisma.integration.findUnique({
      where: { id: settlement.integrationId },
      include: { participant: true },
    });
    const retailerParticipant = retailerIntegration?.participant
      ?? await this.prisma.onboardingParticipant.findUnique({ where: { id: settlement.businessId } });
    if (!retailerParticipant) return null;
    const integration = retailerIntegration?.participantId === retailerParticipant.id
      ? retailerIntegration
      : await this.prisma.integration.findFirst({
        where: { participantId: retailerParticipant.id, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    return this.resolveParticipant(integration, retailerParticipant);
  }

  private resolveParticipant(
    integration: {
      id: string;
      merchantId: string;
      apiSecret: string | null;
      webhookUrl: string | null;
    } | null,
    participant: {
      id: string;
      participantType: string;
      webhookUrl: string | null;
    } | null,
  ): WebhookParticipant | null {
    if (!participant) return null;
    if (participant.participantType !== 'RETAILER') {
      this.logger.error(`Refusing webhook delivery to non-retailer participant ${participant.id}`);
      return null;
    }
    const webhookUrl = participant.webhookUrl ?? integration?.webhookUrl;
    if (!webhookUrl) return null;
    if (!integration?.apiSecret) {
      this.logger.error(`Webhook for participant ${participant.id} is configured without an integration signing secret`);
      return null;
    }
    return {
      merchantId: integration.merchantId,
      integrationId: integration.id,
      participantType: participant.participantType,
      webhookUrl,
      secret: integration.apiSecret,
    };
  }

  private async deliverStored(deliveryId: string, immediateSecret?: string, force = false): Promise<any> {
    const delivery = await this.prisma.settlementWebhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new Error(`Webhook delivery ${deliveryId} was not found`);
    const nextAttemptNumber = delivery.attemptCount + 1;
    const claimWhere: Record<string, unknown> = {
      id: delivery.id,
      status: { in: ['PENDING', 'RETRYING'] },
      ...(force ? {} : { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }),
    };
    const claimed = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.settlementWebhookDelivery.updateMany({
        where: claimWhere,
        data: {
          status: 'DELIVERING',
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });
      if (claim.count !== 1) return false;
      await tx.settlementWebhookDeliveryAttempt.create({
        data: { deliveryId: delivery.id, attemptNumber: nextAttemptNumber },
      });
      return true;
    });
    if (!claimed) return this.prisma.settlementWebhookDelivery.findUnique({ where: { id: delivery.id } });

    const integration = immediateSecret
      ? null
      : await this.prisma.integration.findUnique({
        where: { id: delivery.integrationId },
        select: {
          apiSecret: true,
          webhookUrl: true,
          participant: { select: { webhookUrl: true } },
        },
      });
    const secret = immediateSecret ?? integration?.apiSecret;
    if (!secret) {
      await this.finishDelivery(delivery, 'FAILED', null, 'Webhook signing secret is missing for the integration');
      return this.prisma.settlementWebhookDelivery.findUnique({ where: { id: delivery.id } });
    }
    const configuredEndpoint = integration?.participant?.webhookUrl ?? integration?.webhookUrl;
    if (configuredEndpoint && configuredEndpoint !== delivery.endpoint) {
      await this.prisma.settlementWebhookDelivery.updateMany({
        where: { id: delivery.id, status: 'DELIVERING' },
        data: { endpoint: configuredEndpoint },
      });
      delivery.endpoint = configuredEndpoint;
    }

    let url: URL;
    try {
      url = new URL(delivery.endpoint);
    } catch (error) {
      await this.finishDelivery(delivery, 'FAILED', null, this.errorMessage(error));
      return this.prisma.settlementWebhookDelivery.findUnique({ where: { id: delivery.id } });
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      await this.finishDelivery(delivery, 'FAILED', null, 'Refusing unsupported webhook URL protocol');
      return this.prisma.settlementWebhookDelivery.findUnique({ where: { id: delivery.id } });
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', secret).update(`${timestamp}.${delivery.payload}`).digest('hex');
    const headers = {
      'content-type': 'application/json',
      'x-payassure-event': delivery.eventType,
      'x-payassure-event-id': delivery.eventId,
      'x-payassure-timestamp': timestamp,
      'x-payassure-signature': `t=${timestamp},v1=${signature}`,
    };

    this.logger.log('[SETTLEMENT_WEBHOOK_DELIVERY][REQUEST]', {
      deliveryId: delivery.id,
      attemptNumber: nextAttemptNumber,
      url: url.toString(),
      method: 'POST',
      headers,
      body: delivery.payload,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: delivery.payload,
        signal: controller.signal,
        redirect: 'error',
      });
      const responseBody = await response.text();
      this.logger.log('[SETTLEMENT_WEBHOOK_DELIVERY][RESPONSE]', {
        deliveryId: delivery.id,
        attemptNumber: nextAttemptNumber,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      });
      if (response.ok) {
        await this.finishDelivery(delivery, 'DELIVERED', response.status, null);
      } else {
        const error = `Webhook returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
        const retryable = response.status >= 500 || [408, 425, 429].includes(response.status);
        await this.finishDelivery(delivery, retryable ? 'RETRYING' : 'FAILED', response.status, error);
      }
    } catch (error) {
      await this.finishDelivery(delivery, 'RETRYING', null, this.errorMessage(error));
    } finally {
      clearTimeout(timeout);
    }
    return this.prisma.settlementWebhookDelivery.findUnique({ where: { id: delivery.id } });
  }

  private async finishDelivery(
    delivery: any,
    status: 'DELIVERED' | 'RETRYING' | 'FAILED',
    responseStatus: number | null,
    error: string | null,
  ) {
    const maxAttempts = 8;
    const attemptCount = Number(delivery.attemptCount) + 1;
    const finalStatus = status === 'RETRYING' && attemptCount >= maxAttempts ? 'FAILED' : status;
    const nextAttemptAt = finalStatus === 'RETRYING'
      ? new Date(Date.now() + Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attemptCount - 1))))
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.settlementWebhookDeliveryAttempt.updateMany({
        where: { deliveryId: delivery.id, attemptNumber: attemptCount },
        data: { responseStatus, error },
      });
      await tx.settlementWebhookDelivery.updateMany({
        where: { id: delivery.id, status: 'DELIVERING' },
        data: {
          status: finalStatus,
          lastResponseStatus: responseStatus,
          lastError: error,
          nextAttemptAt,
          ...(finalStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        },
      });
    });
    if (finalStatus === 'FAILED') {
      this.logger.error(
        `Webhook delivery failed for merchant ${delivery.merchantId}, endpoint ${delivery.endpoint}, event ${delivery.eventId}`,
        error ?? `HTTP ${responseStatus}`,
      );
    }
  }

  private asRecord(value: unknown): Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {};
  }

  private cashFunding(metadataValue: unknown, currency: string) {
    const metadata = this.asRecord(metadataValue);
    const escrowFunding = this.asRecord(metadata.escrowFunding);
    const amount = Number(escrowFunding.cashAmount);
    if (escrowFunding.payoutSource !== 'CENTRAL_ACCOUNT' || !Number.isFinite(amount) || amount <= 0) return undefined;
    return {
      amount,
      currency,
      source: 'RETAILER_VIRTUAL_BALANCE',
    };
  }

  private isMissingTableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const details = error as Record<string, unknown>;
    const value = details.code ?? details.name;
    if (value === 'P2021') return true;
    const message = typeof details.message === 'string' ? details.message : '';
    return /does not exist in the current database|relation .* does not exist/i.test(message);
  }

  private errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const cause = 'cause' in error ? error.cause : undefined;
    if (cause === undefined) return error.message;
    return `${error.message}; cause: ${this.describeCause(cause)}`;
  }

  private describeCause(cause: unknown, depth = 0): string {
    if (depth >= 3) return '[cause depth limit reached]';
    if (cause instanceof Error) {
      const details = cause as Error & {
        code?: unknown;
        errno?: unknown;
        syscall?: unknown;
        hostname?: unknown;
        address?: unknown;
        port?: unknown;
      };
      const fields = [
        details.name,
        details.message,
        ...(['code', 'errno', 'syscall', 'hostname', 'address', 'port'] as const)
          .map((key) => details[key])
          .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number'),
      ].filter(Boolean);
      const nestedCause = 'cause' in details ? details.cause : undefined;
      if (nestedCause !== undefined) fields.push(`cause=${this.describeCause(nestedCause, depth + 1)}`);
      const nestedErrors = 'errors' in details && Array.isArray(details.errors)
        ? details.errors as unknown[]
        : [];
      if (nestedErrors.length > 0) {
        fields.push(`errors=[${nestedErrors.map((entry) => this.describeCause(entry, depth + 1)).join('; ')}]`);
      }
      return fields.join(' ') || details.name;
    }
    if (cause && typeof cause === 'object') {
      const details = cause as Record<string, unknown>;
      const fields = ['code', 'errno', 'syscall', 'hostname', 'address', 'port', 'message']
        .flatMap((key) => {
          const value = details[key];
          return typeof value === 'string' || typeof value === 'number' ? [`${key}=${value}`] : [];
        });
      if (details.cause !== undefined) fields.push(`cause=${this.describeCause(details.cause, depth + 1)}`);
      if (Array.isArray(details.errors) && details.errors.length > 0) {
        fields.push(`errors=[${details.errors.map((entry) => this.describeCause(entry, depth + 1)).join('; ')}]`);
      }
      return fields.join(' ') || Object.prototype.toString.call(cause);
    }
    return String(cause);
  }
}
