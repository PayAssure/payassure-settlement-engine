import { Body, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { AuthSessionControllerBase } from './auth-session.controller.base';

export abstract class AuthPasswordControllerBase extends AuthSessionControllerBase {
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request a password reset',
    description: 'Sends a short-lived, single-use six-digit password reset OTP to the requested email address when an active account exists.',
  })
  @ApiResponse({ status: 201, description: 'Password reset request accepted.' })
  @ApiResponse({ status: 400, description: 'Invalid email address.' })
  @ApiResponse({ status: 500, description: 'Password reset email could not be sent.' })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset a password',
    description: 'Consumes a valid six-digit password reset OTP and sets a new password. The OTP can only be used once and expires after one hour.',
  })
  @ApiResponse({ status: 201, description: 'Password reset successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid password or request body.' })
  @ApiResponse({ status: 401, description: 'Password reset OTP is invalid, expired, already used, or belongs to an inactive account.' })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.otp, body.newPassword);
  }
}
