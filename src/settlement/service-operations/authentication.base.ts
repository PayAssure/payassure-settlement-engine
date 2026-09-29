import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus, ParticipantType } from '@prisma/client';
import type { AuthenticateDto } from '../dto/authenticate.dto';
import { AuthenticateResponseDto } from '../dto/settlement-response.dto';
import { authenticateOperation } from '../operations/authenticate.operation';
import { generateSessionToken, hashCredential } from '../helpers/reference.helpers';
import { SettlementAllocationBase } from './allocation.base';

export abstract class SettlementAuthenticationBase extends SettlementAllocationBase {
  async authenticate(data: AuthenticateDto, user: any): Promise<AuthenticateResponseDto> {
    return authenticateOperation(this.prisma, this.repository, data, user, this.TOKEN_EXPIRY);
  }

  async authenticateSupplier(data: AuthenticateDto, user: any): Promise<any> {
    const integration = await this.prisma.integration.findFirst({
      where: { apiKey: data.apiKey, isActive: true },
      include: { participant: true },
    });
    if (!integration) {
      throw new NotFoundException({ statusCode: 404, message: 'Supplier not found with provided API key', error: 'SUPPLIER_NOT_FOUND' });
    }
    if (user && integration.participant && integration.participant.email) {
      const tokenEmail = user.email || '';
      if (tokenEmail !== integration.participant.email) {
        throw new UnauthorizedException({ statusCode: 401, message: 'Authenticated token does not belong to the owner of the provided API credentials', error: 'INVALID_TOKEN_FOR_API_KEYS' });
      }
    }
    const apiSecretHash = hashCredential(data.apiSecret);
    if (apiSecretHash !== integration.apiSecretHash) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid supplier credentials', error: 'INVALID_CREDENTIALS' });
    }
    if (integration.participant.participantType !== ParticipantType.SUPPLIER) {
      throw new ForbiddenException({ statusCode: 403, message: 'Business account is not a supplier', error: 'NOT_A_SUPPLIER' });
    }
    if (integration.participant.status !== ParticipantStatus.ACTIVE) {
      throw new ForbiddenException({ statusCode: 403, message: 'Supplier account is not active', error: 'SUPPLIER_NOT_ACTIVE' });
    }
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRY * 1000);
    await this.repository.createSettlementSession(integration.participantId, integration.id, sessionToken, expiresAt);
    return {
      success: true,
      sessionToken,
      expiresIn: this.TOKEN_EXPIRY,
      tokenType: 'Bearer',
      business: {
        id: integration.participantId,
        businessName: integration.participant.businessName,
        participantType: integration.participant.participantType,
        status: integration.participant.status,
      },
    };
  }

  async getSupplierSettlements(sessionToken: string): Promise<any> {
    const session = await this.repository.findSettlementSessionByToken(sessionToken);
    if (!session) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid supplier session token', error: 'INVALID_SUPPLIER_SESSION' });
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Supplier session has expired', error: 'SUPPLIER_SESSION_EXPIRED' });
    }
    const integration = await this.repository.findIntegrationById(session.integrationId);
    if (!integration || !integration.participant) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid supplier session context', error: 'INVALID_SUPPLIER_SESSION' });
    }
    if (integration.participant.participantType !== ParticipantType.SUPPLIER) {
      throw new ForbiddenException({ statusCode: 403, message: 'Session does not belong to a supplier', error: 'NOT_A_SUPPLIER_SESSION' });
    }
    await this.repository.touchSession(session.id);
    const settlements = await this.repository.findSettlementsBySupplierMerchantId(integration.merchantId);
    return {
      success: true,
      count: settlements.length,
      data: settlements.map((settlement: any) => {
        const payloadSuppliers = Array.isArray(settlement.paymentPayload?.suppliers) ? settlement.paymentPayload.suppliers : [];
        const firstSupplier = payloadSuppliers[0];
        const firstItem = Array.isArray(firstSupplier?.items) ? firstSupplier.items[0] : null;
        const itemReference = firstItem?.itemReference ?? firstItem?.itemId ?? null;
        return {
          reference: settlement.reference,
          merchantTransactionReference: settlement.merchantTransactionReference,
          amount: Number(settlement.amount),
          status: settlement.status,
          retailerMerchantId: settlement.metadata?.retailerMerchantId ?? null,
          itemReference,
        };
      }),
    };
  }
}
