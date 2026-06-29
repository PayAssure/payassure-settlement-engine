import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.hello.findFirst();
  if (!existing) {
    await prisma.hello.create({ data: { text: 'hello world' } });
    console.log('Seeded hello record');
  } else {
    console.log('Hello record already exists');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
