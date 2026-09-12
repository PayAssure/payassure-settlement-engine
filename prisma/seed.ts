import { PrismaClient, ParticipantType, ParticipantStatus } from '@prisma/client';

const prisma = new PrismaClient();

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
