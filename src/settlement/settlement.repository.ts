import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Hello } from '@prisma/client';

@Injectable()
export class SettlementRepository implements OnModuleDestroy {
  private prisma = new PrismaClient();

  async findFirstHello(): Promise<Hello | null> {
    return this.prisma.hello.findFirst();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
