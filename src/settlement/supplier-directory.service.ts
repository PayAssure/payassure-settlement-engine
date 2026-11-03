import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

const supplierDirectorySelect = {
  id: true,
  participantType: true,
  businessName: true,
  businessType: true,
  contactName: true,
  email: true,
  phoneNumber: true,
  physicalAddress: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  payment: true,
  integrations: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      merchantId: true,
      environment: true,
      isActive: true,
      createdAt: true,
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
    participantType: supplier.participantType,
    merchantId: integration?.merchantId ?? null,
    businessName: supplier.businessName,
    businessType: supplier.businessType,
    contactName: supplier.contactName,
    email: supplier.email,
    phoneNumber: supplier.phoneNumber,
    physicalAddress: supplier.physicalAddress,
    status: supplier.status,
    integration: integration
      ? {
          id: integration.id,
          merchantId: integration.merchantId,
          environment: integration.environment,
          isActive: integration.isActive,
          createdAt: integration.createdAt,
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
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
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
