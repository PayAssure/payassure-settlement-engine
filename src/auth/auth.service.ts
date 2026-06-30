import { ConflictException, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthRepository } from './auth.repository';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
  ) {}

  async registerAdmin(data: RegisterAdminDto, actor: any) {
    if (actor?.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a super admin can create another admin');
    }

    return this.createUser(data.username, data.email, data.password, UserRole.ADMIN);
  }

  async registerBeforeOnboarding(data: RegisterDto) {
    const existing = await this.repository.findByEmailOrUsername(data.username, data.email);
    if (existing) {
      const onboarded = await this.repository.findOnboardedByEmail(data.email);
      if (onboarded) {
        return {
          message: 'Account already exists. Please complete onboarding to finish your profile.',
          profileComplete: false,
          user: {
            id: existing.id,
            username: existing.username,
            email: existing.email,
            role: existing.role,
          },
        };
      }
      throw new ConflictException('Username or email already exists');
    }

    return this.createUser(
      data.username,
      data.email,
      data.password,
      UserRole.USER,
      'Account created successfully. Your profile is incomplete. Please complete onboarding to finish setup.',
      false,
    );
  }

  async registerOnboardedUser(data: RegisterDto) {
    const onboarding = await this.repository.findOnboardedByEmail(data.email);
    if (!onboarding) {
      throw new UnauthorizedException('No onboarding record found for this email address');
    }

    const existingUser = await this.repository.findByEmailOrUsername(data.username, data.email);
    if (existingUser) {
      return {
        message: 'Your profile is now complete.',
        profileComplete: true,
        user: {
          id: existingUser.id,
          username: existingUser.username,
          email: existingUser.email,
          role: existingUser.role,
        },
      };
    }

    return this.createUser(
      data.username,
      data.email,
      data.password,
      UserRole.USER,
      'User account created successfully and profile is complete.',
      true,
    );
  }

  async login(data: LoginDto) {
    const user = await this.repository.findByIdentifier(data.identifier);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(data.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

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

  private async createUser(
    username: string,
    email: string,
    password: string,
    role: UserRole,
    message = 'User account created successfully',
    profileComplete = true,
  ) {
    const existing = await this.repository.findByEmailOrUsername(username, email);
    if (existing) {
      throw new ConflictException('Username or email already exists');
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

  private issueTokens(user: any) {
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      version: user.refreshTokenVersion,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  }
}
