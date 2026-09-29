import { Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { PublicOnboardingResponseDto } from '../dto/public-onboarding-response.dto';
import { OnbordingsWebhookControllerBase } from './webhook.controller.base';

export abstract class OnbordingsStaticLookupsControllerBase extends OnbordingsWebhookControllerBase {
  @Get('integration/credentials')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get a user integration credentials by email and active status' })
  @ApiQuery({ name: 'email', required: true, type: String, example: 'merchant@example.com' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, example: true, description: 'Filter on active integration status' })
  @ApiResponse({ status: 200, description: 'Integration credentials for the requested user and active status.' })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Integration credentials not found for the provided email and active status.' })
  async getIntegrationCredentialsByEmail(@Query('email') email: string, @Query('isActive') isActive?: string) {
    const parsedIsActive = isActive === undefined ? undefined : isActive.toLowerCase() === 'true' || isActive === '1';
    return this.service.getIntegrationCredentialsByEmail(email, parsedIsActive);
  }

  @Get()
  @ApiOperation({
    summary: 'List onboarding participants',
    description: 'Publicly lists onboarding participants, integration credentials, and safe payment status details. Authentication is not required. Payment activation secrets, secret hashes, expiry timestamps, and verification attempts are never returned.',
  })
  @ApiResponse({ status: 200, type: [PublicOnboardingResponseDto] })
  async findAll(): Promise<PublicOnboardingResponseDto[]> {
    return this.service.findAllParticipants();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the authenticated onboarding participant' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Onboarding participant not found for the authenticated user.' })
  async findCurrentUser(@Request() req: any): Promise<OnboardingResponseDto> {
    return this.service.findParticipantByAuthenticatedUser(req.user);
  }
}
