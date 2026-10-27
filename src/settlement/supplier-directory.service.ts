import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

const supplierDirectorySelect = {
  id: true,
  businessName: true,
  businessType: true,
  status: true,
  payment: true,
  integrations: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      merchantId: true,
      environment: true,
      isActive: true,
    },
  },
} satisfies Prisma.OnboardingParticipantSelect;

export type SupplierDirectoryRecord = Prisma.OnboardingParticipantGetPayload<{
  select: typeof supplierDirectorySelect;
}>;

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: Prisma.JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function maskPaymentIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  return digits.length > 4 ? `****${digits.slice(-4)}` : '****';
}

export function toSupplierDirectoryEntry(supplier: SupplierDirectoryRecord) {
  const integration = supplier.integrations[0];
  const payment = supplier.payment && isJsonObject(supplier.payment) ? supplier.payment : undefined;
  const paymentType = getString(payment?.type);

  return {
    id: supplier.id,
    merchantId: integration?.merchantId ?? null,
    businessName: supplier.businessName,
    businessType: supplier.businessType,
    status: supplier.status,
    integration: integration
      ? {
          environment: integration.environment,
          isActive: integration.isActive,
        }
      : null,
    payment: paymentType
      ? {
          type: paymentType,
          accountName: getString(payment?.accountName),
          provider: getString(payment?.provider),
          status: getString(payment?.status),
          isVerified: typeof payment?.isVerified === 'boolean' ? payment.isVerified : undefined,
          ...(paymentType === 'MPESA'
            ? { phoneNumber: maskPaymentIdentifier(getString(payment?.phoneNumber)) }
            : {}),
          ...(paymentType === 'BANK'
            ? {
                bankCode: getString(payment?.bankCode),
                shortcode: getString(payment?.shortcode),
                accountNumber: maskPaymentIdentifier(getString(payment?.accountNumber)),
              }
            : {}),
        }
      : null,
  };
}

@Injectable()
export class SupplierDirectoryService implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async getRegisteredSuppliers() {
    const suppliers = await this.prisma.onboardingParticipant.findMany({
      where: { participantType: 'SUPPLIER' },
      orderBy: { businessName: 'asc' },
      select: supplierDirectorySelect,
    });

    return {
      success: true,
      count: suppliers.length,
      suppliers: suppliers.map(toSupplierDirectoryEntry),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
