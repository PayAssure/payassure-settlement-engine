import { Body, Patch, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ActivatePaymentDto } from '../dto/activate-payment.dto';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { UpdatePaymentDto } from '../dto/update-payment.dto';
import { OnbordingsApiKeysControllerBase } from './api-keys.controller.base';

export abstract class OnbordingsPaymentControllerBase extends OnbordingsApiKeysControllerBase {
  @Patch('payment')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update the authenticated user payout destination' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Invalid payment destination data.' })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Onboarding participant not found for the authenticated user.' })
  async updatePayment(@Request() req: any, @Body() body: UpdatePaymentDto): Promise<OnboardingResponseDto> {
    return this.service.updatePaymentForUser(req.user, body.payment);
  }

  @Patch('payment/activate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Activate the authenticated user payment destination',
    description: 'Uses the authenticated user from the JWT bearer token. No participant ID is required; the onboarding participant is located using the decoded token email, matching GET /onbordings/me.',
  })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'The payment activation secret is invalid or expired.' })
  async activatePayment(@Request() req: any, @Body() body: ActivatePaymentDto): Promise<OnboardingResponseDto> {
    this.logger.log(`activatePayment endpoint invoked for authenticated user email=${req.user?.email ?? 'unknown'} username=${req.user?.username ?? 'unknown'}`);
    return this.service.activatePayment(req.user, { paymentActivationSecret: body.paymentActivationSecret });
  }
}
