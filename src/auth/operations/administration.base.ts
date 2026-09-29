import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthAuthenticationBase } from './authentication.base';

export abstract class AuthAdministrationBase extends AuthAuthenticationBase {
  async deleteUser(targetUserId: string, actor: any) {
    const targetUser = await this.repository.findById(targetUserId);
    if (!targetUser) {
      throw new UnauthorizedException('User not found');
    }

    const isSelfDelete = actor?.sub === targetUser.id;
    const isSuperAdmin = actor?.role === UserRole.SUPER_ADMIN;

    if (!isSelfDelete && !isSuperAdmin) {
      throw new ForbiddenException('Only a super admin can delete another user');
    }

    await this.repository.deleteUser(targetUserId);
    return true;
  }

  async getAllUsers(actor: any, filters: any) {
    if (actor?.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only super admins can view all users');
    }

    return this.repository.getAllUsers(filters);
  }
}
