import { Body, Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { GetUsersFilterDto } from './dto/get-users-filter.dto';
import { GetUsersResponseDto } from './dto/get-users-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Register a new admin user',
    description:
      'Creates a new administrator account. This endpoint requires a valid access token from an existing super admin account.',
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
    description:
      'Creates a standard user account for a participant before onboarding is completed. The account is created immediately, but the profile remains incomplete until onboarding is finished.',
  })
  @ApiResponse({ status: 201, description: 'User account created successfully', type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'Email or username already exists' })
  async registerBeforeOnboarding(@Body() body: RegisterDto) {
    return this.authService.registerBeforeOnboarding(body);
  }

  @Post('onboarded-register')
  @ApiOperation({
    summary: 'Register a user after onboarding',
    description:
      'Creates a standard user account for a participant who has completed onboarding or marks an existing registered user as complete.',
  })
  @ApiResponse({ status: 201, description: 'User profile is now complete', type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'Email or username already exists' })
  async onboardedRegister(@Body() body: RegisterDto) {
    return this.authService.registerOnboardedUser(body);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Authenticate a user',
    description:
      'Authenticates a user using either their email or username and password. Returns a short-lived access token and a refresh token.',
  })
  @ApiResponse({ status: 201, description: 'Authentication succeeded', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

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

  @Get('users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get all users with filtering',
    description:
      'Retrieves all users with optional filtering by role, active status, and search. Requires super admin authentication. Supports pagination and sorting.',
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    type: GetUsersResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Only super admins can view all users',
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication token is missing or invalid',
  })
  async getUsers(
    @Query() filters: GetUsersFilterDto,
    @Request() req: any,
  ) {
    return this.authService.getAllUsers(req.user, filters);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh an access token',
    description:
      'Issues a new access token and refresh token when the supplied refresh token is still valid. Refresh tokens are rotated on logout and are rejected after invalidation.',
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
    description:
      'Invalidates the current refresh token version for the signed-in user so future refresh attempts fail until the user logs in again.',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Authentication token is missing or invalid' })
  async logout(@Request() req: any) {
    await this.authService.logout(req.user.sub);
    return { message: 'Logged out successfully' };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete a user',
    description:
      'Allows the authenticated user to delete their own account or allows a super admin to delete any user account.',
  })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 403, description: 'Only a super admin can delete another user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deleteUser(@Param('id') id: string, @Request() req: any) {
    await this.authService.deleteUser(id, req.user);
    return { message: 'User deleted successfully' };
  }
}
