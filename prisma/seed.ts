import { createHash } from 'crypto';
import { PrismaClient, ParticipantType, ParticipantStatus } from '@prisma/client';

const prisma = new PrismaClient();

const demoSuppliers = [
  { number: '001', businessName: 'Demo Acacia Foods Ltd', registrationNumber: 'DEMO-REG-001', kraPin: 'DEMO-KRA-001', industry: 'Food distribution', contactName: 'Amina Demo', email: 'supplier001@example.com', phoneNumber: '+254700000001', physicalAddress: 'Nairobi, Kenya', bankCode: '00', accountNumber: '000000000001' },
  { number: '002', businessName: 'Demo Baobab Packaging Ltd', registrationNumber: 'DEMO-REG-002', kraPin: 'DEMO-KRA-002', industry: 'Packaging', contactName: 'Brian Demo', email: 'supplier002@example.com', phoneNumber: '+254700000002', physicalAddress: 'Mombasa, Kenya', bankCode: '00', accountNumber: '000000000002' },
  { number: '003', businessName: 'Demo Cedar Office Supplies Ltd', registrationNumber: 'DEMO-REG-003', kraPin: 'DEMO-KRA-003', industry: 'Office supplies', contactName: 'Cynthia Demo', email: 'supplier003@example.com', phoneNumber: '+254700000003', physicalAddress: 'Kisumu, Kenya', bankCode: '00', accountNumber: '000000000003' },
  { number: '004', businessName: 'Demo Dhow Logistics Ltd', registrationNumber: 'DEMO-REG-004', kraPin: 'DEMO-KRA-004', industry: 'Logistics', contactName: 'Daniel Demo', email: 'supplier004@example.com', phoneNumber: '+254700000004', physicalAddress: 'Nakuru, Kenya', bankCode: '00', accountNumber: '000000000004' },
  { number: '005', businessName: 'Demo Elm Cleaning Products Ltd', registrationNumber: 'DEMO-REG-005', kraPin: 'DEMO-KRA-005', industry: 'Cleaning products', contactName: 'Esther Demo', email: 'supplier005@example.com', phoneNumber: '+254700000005', physicalAddress: 'Eldoret, Kenya', bankCode: '00', accountNumber: '000000000005' },
  { number: '006', businessName: 'Demo Fig Farm Produce Ltd', registrationNumber: 'DEMO-REG-006', kraPin: 'DEMO-KRA-006', industry: 'Agriculture', contactName: 'Farah Demo', email: 'supplier006@example.com', phoneNumber: '+254700000006', physicalAddress: 'Thika, Kenya', bankCode: '00', accountNumber: '000000000006' },
  { number: '007', businessName: 'Demo Grevillea Hardware Ltd', registrationNumber: 'DEMO-REG-007', kraPin: 'DEMO-KRA-007', industry: 'Hardware', contactName: 'George Demo', email: 'supplier007@example.com', phoneNumber: '+254700000007', physicalAddress: 'Machakos, Kenya', bankCode: '00', accountNumber: '000000000007' },
  { number: '008', businessName: 'Demo Hibiscus Medical Supplies Ltd', registrationNumber: 'DEMO-REG-008', kraPin: 'DEMO-KRA-008', industry: 'Medical supplies', contactName: 'Hannah Demo', email: 'supplier008@example.com', phoneNumber: '+254700000008', physicalAddress: 'Nyeri, Kenya', bankCode: '00', accountNumber: '000000000008' },
  { number: '009', businessName: 'Demo Imara Textiles Ltd', registrationNumber: 'DEMO-REG-009', kraPin: 'DEMO-KRA-009', industry: 'Textiles', contactName: 'Isaac Demo', email: 'supplier009@example.com', phoneNumber: '+254700000009', physicalAddress: 'Kakamega, Kenya', bankCode: '00', accountNumber: '000000000009' },
  { number: '010', businessName: 'Demo Jacaranda Electronics Ltd', registrationNumber: 'DEMO-REG-010', kraPin: 'DEMO-KRA-010', industry: 'Electronics', contactName: 'Joy Demo', email: 'supplier010@example.com', phoneNumber: '+254700000010', physicalAddress: 'Meru, Kenya', bankCode: '00', accountNumber: '000000000010' },
] as const;

function hashDemoCredential(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function seedDemoSuppliers() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo suppliers must not be seeded into a production database.');
  }

  for (const supplier of demoSuppliers) {
    const id = `demo_supplier_${supplier.number}`;
    const merchantId = `pay_demo_supplier_${supplier.number}`;
    const apiKey = `pk_test_seed_supplier_${supplier.number}`;
    const apiSecret = `sk_test_seed_supplier_${supplier.number}`;
    const webhookUrl = `https://example.com/webhooks/suppliers/${supplier.number}`;
    const now = new Date().toISOString();

    await prisma.onboardingParticipant.upsert({
      where: { id },
      create: {
        id,
        participantType: ParticipantType.SUPPLIER,
        businessName: supplier.businessName,
        registrationNumber: supplier.registrationNumber,
        kraPin: supplier.kraPin,
        businessType: 'Limited Company',
        industry: supplier.industry,
        physicalAddress: supplier.physicalAddress,
        contactName: supplier.contactName,
        email: supplier.email,
        phoneNumber: supplier.phoneNumber,
        settlementMethod: 'BANK',
        settlementAccount: supplier.accountNumber,
        settlementPreference: 'DAILY',
        webhookUrl,
        status: ParticipantStatus.ACTIVE,
        payment: {
          type: 'BANK',
          accountName: supplier.businessName,
          bankCode: supplier.bankCode,
          accountNumber: supplier.accountNumber,
          provider: 'Demo Bank (test only)',
          status: 'VERIFIED',
          isVerified: true,
          verificationMethod: 'SEED_DEMO',
          verifiedAt: now,
          verificationAttempts: 0,
        },
      },
      update: {
        participantType: ParticipantType.SUPPLIER,
        businessName: supplier.businessName,
        registrationNumber: supplier.registrationNumber,
        kraPin: supplier.kraPin,
        businessType: 'Limited Company',
        industry: supplier.industry,
        physicalAddress: supplier.physicalAddress,
        contactName: supplier.contactName,
        email: supplier.email,
        phoneNumber: supplier.phoneNumber,
        settlementMethod: 'BANK',
        settlementAccount: supplier.accountNumber,
        settlementPreference: 'DAILY',
        webhookUrl,
        status: ParticipantStatus.ACTIVE,
        payment: {
          type: 'BANK',
          accountName: supplier.businessName,
          bankCode: supplier.bankCode,
          accountNumber: supplier.accountNumber,
          provider: 'Demo Bank (test only)',
          status: 'VERIFIED',
          isVerified: true,
          verificationMethod: 'SEED_DEMO',
          verifiedAt: now,
          verificationAttempts: 0,
        },
      },
    });

    await prisma.integration.upsert({
      where: { merchantId },
      create: {
        participantId: id,
        merchantId,
        apiKey,
        apiSecret,
        apiKeyHash: hashDemoCredential(apiKey),
        apiSecretHash: hashDemoCredential(apiSecret),
        environment: 'sandbox',
        webhookUrl,
        isActive: true,
      },
      update: {
        participantId: id,
        apiKey,
        apiSecret,
        apiKeyHash: hashDemoCredential(apiKey),
        apiSecretHash: hashDemoCredential(apiSecret),
        environment: 'sandbox',
        webhookUrl,
        isActive: true,
      },
    });
  }

  console.log(`Seeded ${demoSuppliers.length} active demo suppliers with verified test payout destinations and sandbox integrations.`);
}

async function seedRetailerEscrowAccounts() {
  const retailers = await prisma.onboardingParticipant.findMany({
    where: {
      participantType: ParticipantType.RETAILER,
      status: { in: [ParticipantStatus.ACTIVE, ParticipantStatus.LIVE] },
    },
    include: { integrations: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  const defaultSeedBalance = 250000;

  for (const retailer of retailers) {
    const merchantId = retailer.integrations?.[0]?.merchantId ?? retailer.email ?? retailer.id;
    const customerId = merchantId;
    const existing = await prisma.mockBankEscrowAccount.findUnique({ where: { customerId } });

    if (existing) {
      await prisma.mockBankEscrowAccount.update({
        where: { customerId },
        data: {
          merchantId,
          customerEmail: retailer.email ?? existing.customerEmail,
          status: 'ACTIVE',
          balance: existing.balance,
          notes: existing.notes ?? `Escrow account for ${retailer.businessName}`,
        },
      });
      console.log(`Ensured escrow account for retailer ${retailer.businessName} (${customerId})`);
      continue;
    }

    const account = await prisma.mockBankEscrowAccount.create({
      data: {
        customerId,
        merchantId,
        customerEmail: retailer.email,
        currency: 'KES',
        balance: defaultSeedBalance,
        status: 'ACTIVE',
        accountType: 'RETAILER_ESCROW',
        notes: `Seeded retailer escrow for ${retailer.businessName}`,
      },
    });

    await prisma.mockBankEscrowTransaction.create({
      data: {
        accountId: account.id,
        customerId: account.customerId,
        type: 'DEPOSIT',
        amount: defaultSeedBalance,
        balanceAfter: defaultSeedBalance,
        provider: 'SEED',
        scenario: 'seed',
        description: `Initial escrow deposit for ${retailer.businessName}`,
      },
    });

    console.log(`Seeded escrow account for retailer ${retailer.businessName} (${customerId}) with KES ${defaultSeedBalance}`);
  }
}

async function main() {
  const existing = await prisma.hello.findFirst();
  if (!existing) {
    await prisma.hello.create({ data: { text: 'hello world' } });
    console.log('Seeded hello record');
  }

  if (process.env.SEED_DEMO_SUPPLIERS === 'true') {
    await seedDemoSuppliers();
  }

  await seedRetailerEscrowAccounts();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
