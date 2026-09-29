import { Body, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CreateOnboardingDto } from '../dto/create-onboarding.dto';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { OnbordingsControllerContextBase } from './controller-context.base';

export abstract class OnbordingsCreateControllerBase extends OnbordingsControllerContextBase {
  @Post()
  @ApiOperation({ summary: 'Create a retailer or supplier onboarding record' })
  @ApiResponse({ status: 201, type: OnboardingResponseDto })
  @ApiResponse({ status: 500, type: ErrorResponseDto, description: 'An unexpected error occurred while creating the onboarding record.' })
  async create(@Body() body: CreateOnboardingDto): Promise<OnboardingResponseDto> {
    this.logger.log('[ONBOARDING_CREATE_REQUEST]', body);
    const response = await this.service.createParticipant(body);
    this.logger.log('[ONBOARDING_CREATE_RESPONSE]', response);
    return response;
  }
}
