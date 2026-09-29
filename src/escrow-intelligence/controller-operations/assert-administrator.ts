import { ForbiddenException } from '@nestjs/common';

export function assertAdministrator(user: any): void {
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user?.role)) {
    throw new ForbiddenException('Only administrators can manage retailer escrow floats');
  }
}
