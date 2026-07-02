import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ParticipantStatus, PrismaClient, UserRole } from '@prisma/client';

@Injectable()
export class AuthRepository implements OnModuleDestroy {
  private prisma = new PrismaClient();

  async createUser(data: { username: string; email: string; passwordHash: string; role: UserRole }) {
    return this.prisma.user.create({ data });
  }

  async findByIdentifier(identifier: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
      },
    });
  }

  async findByEmailOrUsername(username: string, email: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findOnboardedByEmail(email: string) {
    return this.prisma.onboardingParticipant.findFirst({
      where: { email },
    });
  }

  async activateBusinessIfComplete(email: string) {
    const participant = await this.prisma.onboardingParticipant.findFirst({
      where: { email },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (!participant) {
      return;
    }

    const requiredFields = [
      participant.participantType,
      participant.businessName,
      participant.contactName,
      participant.email,
      participant.phoneNumber,
      participant.settlementMethod,
      participant.settlementAccount,
    ];

    const profileComplete = requiredFields.every((value) =>
      typeof value === 'string' ? value.trim().length > 0 : Boolean(value),
    );

    if (!profileComplete) {
      return;
    }

    const existingIntegration = participant.integrations?.[0];
    if (!existingIntegration || participant.status === ParticipantStatus.LIVE || participant.status === ParticipantStatus.ACTIVE) {
      return;
    }

    await this.prisma.onboardingParticipant.update({
      where: { id: participant.id },
      data: { status: ParticipantStatus.LIVE },
    });
  }

  async incrementRefreshTokenVersion(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenVersion: { increment: 1 } },
    });
  }

  async deleteUser(userId: string) {
    return this.prisma.user.delete({ where: { id: userId } });
  }

  async getAllUsers(filters: {
    role?: string;
    isActive?: boolean;
    search?: string;
    skip?: number;
    take?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const { role, isActive, search, skip = 0, take = 10, sortBy = 'createdAt', sortOrder = 'desc' } = filters;

    const where: any = {};

    if (role) {
      where.role = role;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        skip,
        take,
        orderBy: {
          [sortBy]: sortOrder,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      total,
      skip,
      take,
      hasMore: skip + take < total,
    };
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}

