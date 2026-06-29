import { ApiProperty } from '@nestjs/swagger';

export class UserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class GetUsersResponseDto {
  @ApiProperty({ type: [UserDto] })
  data!: UserDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  take!: number;

  @ApiProperty()
  hasMore!: boolean;
}
