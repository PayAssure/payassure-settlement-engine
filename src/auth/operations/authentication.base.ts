import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthRegistrationBase } from './registration.base';
import { LoginDto } from '../dto/login.dto';

export abstract class AuthAuthenticationBase extends AuthRegistrationBase {
  async login(data: LoginDto) {
    const user = await this.repository.findByIdentifier(data.identifier);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(data.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.repository.linkParticipantToUser(user.email, user.id);
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.repository.findById(payload.sub);
      if (!user || !user.isActive || user.refreshTokenVersion !== payload.version) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const updatedUser = await this.repository.incrementRefreshTokenVersion(user.id);
      return this.issueTokens(updatedUser);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string) {
    await this.repository.incrementRefreshTokenVersion(userId);
    return true;
  }
}
