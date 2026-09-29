import { Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { OnbordingsStaticLookupsControllerBase } from './static-lookups.controller.base';

export abstract class OnbordingsApiKeysControllerBase extends OnbordingsStaticLookupsControllerBase {
  @Post('generate-keys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Generate API keys for the authenticated user' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 500, type: ErrorResponseDto, description: 'API key generation failed because generated credential data was invalid. No partial credentials were persisted.' })
  async generateApiKeys(@Request() req: any): Promise<OnboardingResponseDto> {
    return this.service.generateApiKeys(req.user);
  }

  @Get('keys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'View API keys for the authenticated user' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'API keys not found for the authenticated user.' })
  async viewApiKeys(@Request() req: any): Promise<OnboardingResponseDto> {
    return this.service.viewApiKeys(req.user);
  }
}
