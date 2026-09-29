import { ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthTokensBase } from './tokens.base';

export abstract class AuthUsersBase extends AuthTokensBase {
  protected async createUser(
    username: string,
    email: string,
    password: string,
    role: UserRole,
    message = 'User account created successfully',
    profileComplete = true,
  ) {
    const emailExisting = await this.repository.findByEmail(email);
    const usernameExisting = await this.repository.findByUsername(username);

    if (emailExisting || usernameExisting) {
      if (emailExisting) {
        throw new ConflictException('Email already exists');
      }
      throw new ConflictException('Username already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.repository.createUser({ username, email, passwordHash, role });
    return {
      message,
      profileComplete,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  }
}
