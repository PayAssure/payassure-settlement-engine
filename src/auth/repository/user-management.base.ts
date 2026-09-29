import { AuthUserSearchBase } from './user-search.base';

export abstract class AuthUserManagementBase extends AuthUserSearchBase {
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
}
