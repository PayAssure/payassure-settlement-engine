import { Body, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { AuthRegistrationControllerBase } from './auth-registration.controller.base';

export abstract class AuthSessionControllerBase extends AuthRegistrationControllerBase {
  @Post('login')
  @ApiOperation({
    summary: 'Authenticate a user',
    description: 'Authenticates a user using either their email or username and password. Returns a short-lived access token and a refresh token.',
  })
  @ApiResponse({ status: 201, description: 'Authentication succeeded', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh an access token',
    description: 'Issues a new access token and refresh token when the supplied refresh token is still valid. Refresh tokens are rotated on logout and are rejected after invalidation.',
  })
  @ApiResponse({ status: 201, description: 'Tokens refreshed successfully', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token is missing, expired, or invalid' })
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Logout the current user',
    description: 'Invalidates the current refresh token version for the signed-in user so future refresh attempts fail until the user logs in again.',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Authentication token is missing or invalid' })
  async logout(@Request() req: any) {
    await this.authService.logout(req.user.sub);
    return { message: 'Logged out successfully' };
  }
}
