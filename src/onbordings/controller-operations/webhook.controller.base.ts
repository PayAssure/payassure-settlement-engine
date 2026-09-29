import { Body, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { UpdateWebhookDto } from '../dto/update-webhook.dto';
import { OnbordingsParticipantDetailsControllerBase } from './participant-details.controller.base';

export abstract class OnbordingsWebhookControllerBase extends OnbordingsParticipantDetailsControllerBase {
  @Patch(':id/webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update the webhook URL for a participant integration' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Participant not found.' })
  async updateWebhook(@Param('id') id: string, @Body() body: UpdateWebhookDto): Promise<OnboardingResponseDto> {
    return this.service.updateWebhook(id, body.webhookUrl);
  }
}
