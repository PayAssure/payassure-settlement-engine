import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus, ParticipantType, Prisma } from '@prisma/client';
import { prisma } from '../../common/database/prisma';
import type { EscrowJsonRecord } from './retailer-escrow-transfer.helpers';

class RetailerEscrowFloatService {
  async getAuthenticatedRetailerMerchantId(user: { email?: string } | undefined): Promise<string> {
    if (!user?.email) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Authenticated retailer user is required', error: 'MISSING_RETAILER_USER' });
    }
    const integration = await prisma.integration.findFirst({
      where: {
        isActive: true,
        participant: {
          email: user.email,
          participantType: ParticipantType.RETAILER,
          status: ParticipantStatus.ACTIVE,
        },
      },
      include: { participant: true },
    });
    if (!integration) {
      throw new ForbiddenException({ statusCode: 403, message: 'Authenticated user does not belong to an active retailer', error: 'RETAILER_USER_MISMATCH' });
    }
    return integration.merchantId;
  }

  async hasFloatConfig(merchantId: string): Promise<boolean> {
    return Boolean(await prisma.retailerEscrowFloat.findUnique({ where: { merchantId }, select: { id: true } }));
  }

  async getFloat(merchantId: string): Promise<EscrowJsonRecord> {
    const config = await prisma.retailerEscrowFloat.findUnique({ where: { merchantId } });
    if (!config) throw new NotFoundException(`Escrow float is not configured for retailer ${merchantId}`);
    return {
      merchantId: config.merchantId,
      currency: config.currency,
      dailyFloat: Number(config.dailyFloat),
      expectedRemainingBalance: Number(config.expectedRemainingBalance),
      tillNumber: config.tillNumber,
      storeNumber: config.storeNumber,
      updatedAt: config.updatedAt,
    };
  }

  async setFloat(
    merchantId: string,
    dailyFloat: number,
    expectedRemainingBalance?: number,
    tillNumber?: string,
    storeNumber?: string,
  ): Promise<EscrowJsonRecord> {
    if (!Number.isFinite(dailyFloat) || dailyFloat < 0) {
      throw new Error('dailyFloat must be a non-negative number');
    }
    if (expectedRemainingBalance !== undefined && (!Number.isFinite(expectedRemainingBalance) || expectedRemainingBalance < 0)) {
      throw new Error('expectedRemainingBalance must be a non-negative number');
    }

    const integration = await prisma.integration.findUnique({
      where: { merchantId },
      include: { participant: true },
    });
    if (!integration || integration.participant.participantType !== ParticipantType.RETAILER) {
      throw new NotFoundException(`Retailer integration ${merchantId} was not found`);
    }

    const existing = await prisma.retailerEscrowFloat.findUnique({ where: { merchantId } });
    let config;
    if (existing) {
      const updated = await prisma.retailerEscrowFloat.updateMany({
        where: { id: existing.id, activeTransferId: null },
        data: {
          dailyFloat: new Prisma.Decimal(dailyFloat),
          ...(tillNumber === undefined ? {} : { tillNumber: tillNumber.trim() || null }),
          ...(storeNumber === undefined ? {} : { storeNumber: storeNumber.trim() || null }),
          ...(expectedRemainingBalance === undefined
            ? {}
            : { expectedRemainingBalance: new Prisma.Decimal(expectedRemainingBalance) }),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Cannot edit the float while an escrow transfer is in progress');
      }
      config = await prisma.retailerEscrowFloat.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      config = await prisma.retailerEscrowFloat.create({
        data: {
          merchantId,
          dailyFloat: new Prisma.Decimal(dailyFloat),
          expectedRemainingBalance: new Prisma.Decimal(expectedRemainingBalance ?? dailyFloat),
          tillNumber: tillNumber?.trim() || null,
          storeNumber: storeNumber?.trim() || null,
        },
      });
    }

    return {
      merchantId: config.merchantId,
      currency: config.currency,
      dailyFloat: Number(config.dailyFloat),
      expectedRemainingBalance: Number(config.expectedRemainingBalance),
      tillNumber: config.tillNumber,
      storeNumber: config.storeNumber,
      updatedAt: config.updatedAt,
    };
  }
}

export const retailerEscrowFloatService = new RetailerEscrowFloatService();