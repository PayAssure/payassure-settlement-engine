import { Body, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { RegisterResponseDto } from '../dto/register-response.dto';
import { RegisterAdminDto } from '../dto/register-admin.dto';
import { RegisterDto } from '../dto/register.dto';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { AuthControllerContextBase } from './auth-controller-context.base';

export abstract class AuthRegistrationControllerBase extends AuthControllerContextBase {
  @Post('register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Register a new admin user',
    description: 'Creates a new administrator account. This endpoint requires a valid access token from an existing super admin account.',
  })
  @ApiResponse({ status: 201, description: 'Admin account created successfully', type: RegisterResponseDto })
  @ApiResponse({ status: 403, description: 'The caller is not a super admin' })
  @ApiResponse({ status: 401, description: 'Authentication token is missing or invalid' })
  async register(@Body() body: RegisterAdminDto, @Request() req: any) {
    return this.authService.registerAdmin(body, req.user);
  }

  @Post('register-before-onboarding')
  @ApiOperation({
    summary: 'Register a user account before onboarding',
    description: 'Creates a standard user account for a participant before onboarding is completed. The account is created immediately, but the profile remains incomplete until onboarding is finished.',
  })
  @ApiResponse({ status: 201, description: 'User account created successfully', type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'Email or username already exists' })
  async registerBeforeOnboarding(@Body() body: RegisterDto) {
    return this.authService.registerBeforeOnboarding(body);
  }

  @Post('onboarded-register')
  @ApiOperation({
    summary: 'Register a user after onboarding',
    description: 'Creates a standard user account for a participant who has completed onboarding or marks an existing registered user as complete.',
  })
  @ApiResponse({ status: 201, description: 'User profile is now complete', type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'Email or username already exists' })
  async onboardedRegister(@Body() body: RegisterDto) {
    return this.authService.registerOnboardedUser(body);
  }
}
