import { ConflictException, Injectable, UnauthorizedException, ForbiddenException, InternalServerErrorException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { AuthRepository } from './auth.repository';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { UserRole } from '@prisma/client';
import { EmailService } from '../onbordings/email.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  private readonly passwordResetTokenLifetimeMs = 60 * 60 * 1000;

  async requestPasswordReset(email: string) {
    const genericResponse = {
      message: 'If an account exists for that email, a password reset OTP has been sent.',
    };
    const user = await this.repository.findByEmail(email);

    if (!user || !user.isActive) {
      return genericResponse;
    }

    const otp = randomInt(100000, 1000000).toString();
    const tokenHash = createHash('sha256').update(otp).digest('hex');
    const expiresAt = new Date(Date.now() + this.passwordResetTokenLifetimeMs);

    await this.repository.deletePasswordResetTokens(user.id);
    await this.repository.createPasswordResetToken({ userId: user.id, tokenHash, expiresAt });

    try {
      if (!this.emailService) {
        throw new Error('Email service is not configured');
      }

      await this.emailService.sendPasswordResetEmail({
        email: user.email,
        username: user.username,
        otp,
        expiresAt: expiresAt.toISOString(),
      });
    } catch {
      await this.repository.deletePasswordResetTokens(user.id);
      throw new InternalServerErrorException('Unable to send password reset email');
    }

    return genericResponse;
  }

  async resetPassword(otp: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(otp).digest('hex');
    const resetToken = await this.repository.findPasswordResetToken(tokenHash);

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date() || !resetToken.user.isActive) {
      throw new UnauthorizedException('Invalid or expired password reset OTP');
    }

    const consumed = await this.repository.consumePasswordResetToken(resetToken.id);
    if (consumed.count !== 1) {
      throw new UnauthorizedException('Invalid or expired password reset OTP');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updatedUser = await this.repository.updatePassword(resetToken.user.id, passwordHash);
    await this.repository.incrementRefreshTokenVersion(updatedUser.id);

    return { message: 'Password reset successfully. Please log in with your new password.' };
  }

  async registerAdmin(data: RegisterAdminDto, actor: any) {
    if (actor?.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a super admin can create another admin');
    }

    return this.createUser(data.username, data.email, data.password, UserRole.ADMIN);
  }

  async registerBeforeOnboarding(data: RegisterDto) {
    const emailExisting = await this.repository.findByEmail(data.email);
    const usernameExisting = await this.repository.findByUsername(data.username);

    if (emailExisting || usernameExisting) {
      if (emailExisting) {
        const onboarded = await this.repository.findOnboardedByEmail(data.email);
        if (onboarded) {
          await this.repository.linkParticipantToUser(data.email, emailExisting.id);
          return {
            message: 'Account already exists. Please complete onboarding to finish your profile.',
            profileComplete: false,
            user: {
              id: emailExisting.id,
              username: emailExisting.username,
              email: emailExisting.email,
              role: emailExisting.role,
            },
          };
        }

        throw new ConflictException('Email already exists');
      }

      throw new ConflictException('Username already exists');
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

    const profileComplete = this.isProfileComplete(onboarding);
    if (profileComplete) {
      await this.repository.activateBusinessIfComplete(data.email);
    }

    const existingUser = await this.repository.findByEmailOrUsername(data.username, data.email);
    if (existingUser) {
      await this.repository.linkParticipantToUser(data.email, existingUser.id);
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

    const response = await this.createUser(
      data.username,
      data.email,
      data.password,
      UserRole.USER,
      'User account created successfully and profile is complete.',
      true,
    );
    await this.repository.linkParticipantToUser(data.email, response.user.id);
    return response;
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

  private async issueTokens(user: any) {
    const profileStatus = await this.getProfileStatus(user.email);
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      version: user.refreshTokenVersion,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '3m' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '30m' });

    return {
      accessToken,
      refreshToken,
      profileComplete: profileStatus.profileComplete,
      message: profileStatus.message,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  }

  private async getProfileStatus(email: string) {
    const onboarding = await this.repository.findOnboardedByEmail(email);
    const profileComplete = this.isProfileComplete(onboarding);

    return {
      profileComplete,
      message: profileComplete
        ? 'Profile complete.'
        : 'Your profile is incomplete. Please finish onboarding to get API keys access.',
    };
  }

  private isProfileComplete(onboarding: any): boolean {
    if (!onboarding) {
      return false;
    }

    const requiredFields = [
      onboarding.participantType,
      onboarding.businessName,
      onboarding.contactName,
      onboarding.email,
      onboarding.phoneNumber,
      onboarding.settlementMethod,
      onboarding.settlementAccount,
    ];

    return requiredFields.every((value) => Boolean(value) && (!String(value).trim || String(value).trim().length > 0));
  }
}
