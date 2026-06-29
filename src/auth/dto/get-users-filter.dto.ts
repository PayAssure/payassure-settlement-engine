import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsBoolean, IsString, IsInt, Min } from 'class-validator';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';

export class GetUsersFilterDto {
  @ApiProperty({
    description: 'Filter by user role',
    enum: UserRole,
    required: false,
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({
    description: 'Filter by active status',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({
    description: 'Search by username or email (partial match)',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'Number of records to skip (for pagination)',
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number = 0;

  @ApiProperty({
    description: 'Number of records to return (for pagination)',
    required: false,
    default: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  take?: number = 10;

  @ApiProperty({
    description: 'Field to sort by',
    enum: ['username', 'email', 'role', 'createdAt', 'updatedAt'],
    required: false,
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiProperty({
    description: 'Sort order (asc or desc)',
    enum: ['asc', 'desc'],
    required: false,
    default: 'desc',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
