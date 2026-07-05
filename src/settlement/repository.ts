import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SessionRepository } from './repository/session/session.repository';
import { IntegrationRepository } from './repository/integration/integration.repository';
import { SettlementRecordRepository } from './repository/settlement/settlement.repository';
import { TransactionRepository } from './repository/transaction/transaction.repository';

@Injectable()
export class SettlementRepository implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  readonly sessions: SessionRepository;
  readonly integrations: IntegrationRepository;
  readonly settlements: SettlementRecordRepository;
  readonly transactions: TransactionRepository;

  constructor() {
    this.sessions = new SessionRepository(this.prisma);
    this.integrations = new IntegrationRepository(this.prisma);
    this.settlements = new SettlementRecordRepository(this.prisma);
    this.transactions = new TransactionRepository(this.prisma);
  }

  async createSettlementSession(businessId: string, integrationId: string, token: string, expiresAt: Date) {
    return this.sessions.createSettlementSession(businessId, integrationId, token, expiresAt);
  }

  async findSettlementSessionByToken(token: string) {
    return this.sessions.findSettlementSessionByToken(token);
  }

  async findIntegrationById(id: string) {
    return this.integrations.findIntegrationById(id);
  }

  async findIntegrationByMerchantId(merchantId: string) {
    return this.integrations.findIntegrationByMerchantId(merchantId);
  }

  async markSessionAsUsed(sessionId: string) {
    return this.sessions.markSessionAsUsed(sessionId);
  }

  async deleteExpiredSessions() {
    return this.sessions.deleteExpiredSessions();
  }

  async createSettlement(businessId: string, integrationId: string, payAssureReference: string, internalMerchantTransactionReference: string, data: any) {
    return this.settlements.createSettlement(businessId, integrationId, payAssureReference, internalMerchantTransactionReference, data);
  }

  async createSupplierSettlement(businessId: string, integrationId: string, data: any) {
    return this.settlements.createSupplierSettlement(businessId, integrationId, data);
  }

  async findSettlementById(id: string) {
    return this.settlements.findSettlementById(id);
  }

  async findSettlementByBusinessAndPayloadReference(businessId: string, payloadMerchantTransactionReference: string) {
    return this.settlements.findSettlementByBusinessAndPayloadReference(businessId, payloadMerchantTransactionReference);
  }

  async findSettlementsByBusinessId(businessId: string, skip = 0, take = 10) {
    return this.settlements.findSettlementsByBusinessId(businessId, skip, take);
  }

  async updateSettlementStatus(id: string, status: any, updates?: Record<string, any>) {
    return this.settlements.updateSettlementStatus(id, status, updates);
  }

  async updateSettlementReconciliation(id: string, bankReference: string, bankTransactionId?: string) {
    return this.settlements.updateSettlementReconciliation(id, bankReference, bankTransactionId);
  }

  async createTransaction(settlementId: string, itemId: string, supplierMerchantId: string, type: string, amount: number, quantity?: number, unitPrice?: number, description?: string) {
    return this.transactions.createTransaction(settlementId, itemId, supplierMerchantId, type, amount, quantity, unitPrice, description);
  }

  async findTransactionById(id: string) {
    return this.transactions.findTransactionById(id);
  }

  async findTransactionsBySettlementId(settlementId: string) {
    return this.transactions.findTransactionsBySettlementId(settlementId);
  }

  async updateTransactionStatus(id: string, status: any) {
    return this.transactions.updateTransactionStatus(id, status);
  }

  async createMultipleTransactions(settlementId: string, items: Array<any>) {
    return this.transactions.createMultipleTransactions(settlementId, items);
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
