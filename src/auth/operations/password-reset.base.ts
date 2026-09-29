import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { AuthAdministrationBase } from './administration.base';

export abstract class AuthPasswordResetBase extends AuthAdministrationBase {
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
}
