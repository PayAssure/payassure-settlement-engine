import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export async function bootstrapSuperAdmin() {
  const prisma = new PrismaClient();
  const existing = await prisma.user.findFirst({
    where: { email: 'kimaniwilfred95@gmail.com' },
  });

  if (!existing) {
    const passwordHash = await bcrypt.hash('123456', 10);
    await prisma.user.create({
      data: {
        username: 'wilfred',
        email: 'kimaniwilfred95@gmail.com',
        passwordHash,
        role: 'SUPER_ADMIN',
      },
    });
  }

  await prisma.$disconnect();
}
