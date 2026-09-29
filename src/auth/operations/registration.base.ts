import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RegisterAdminDto } from '../dto/register-admin.dto';
import { RegisterDto } from '../dto/register.dto';
import { AuthUsersBase } from './users.base';

export abstract class AuthRegistrationBase extends AuthUsersBase {
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
}
