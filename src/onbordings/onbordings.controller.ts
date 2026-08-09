import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ErrorResponseDto } from './dto/error-response.dto';
import { OnboardingResponseDto } from './dto/onboarding-response.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { ActivatePaymentDto } from './dto/activate-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { OnbordingsService } from './onbordings.service';

@ApiTags('onbordings')
@Controller('onbordings')
export class OnbordingsController {
  private readonly logger = new Logger(OnbordingsController.name);

  constructor(private readonly service: OnbordingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a retailer or supplier onboarding record' })
  @ApiResponse({ status: 201, type: OnboardingResponseDto })
  @ApiResponse({
    status: 500,
    type: ErrorResponseDto,
    description: 'An unexpected error occurred while creating the onboarding record.',
  })
  async create(@Body() body: CreateOnboardingDto): Promise<OnboardingResponseDto> {
    return this.service.createParticipant(body);
  }

  @Post('generate-keys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Generate API keys for the authenticated user' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  @ApiResponse({
    status: 500,
    type: ErrorResponseDto,
    description:
      'API key generation failed because generated credential data was invalid. No partial credentials were persisted.',
  })
  async generateApiKeys(@Request() req: any): Promise<OnboardingResponseDto> {
    return this.service.generateApiKeys(req.user);
  }

  @Get('keys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'View API keys for the authenticated user' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'API keys not found for the authenticated user.',
  })
  async viewApiKeys(@Request() req: any): Promise<OnboardingResponseDto> {
    return this.service.viewApiKeys(req.user);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List onboarding participants' })
  @ApiResponse({ status: 200, type: [OnboardingResponseDto] })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  async findAll(): Promise<OnboardingResponseDto[]> {
    return this.service.findAllParticipants();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get an onboarding participant by id' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'Participant not found.',
  })
  async findOne(@Param('id') id: string): Promise<OnboardingResponseDto> {
    return this.service.findParticipantById(id);
  }

  @Patch('payment')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update the authenticated user payout destination' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'Invalid payment destination data.',
  })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'Onboarding participant not found for the authenticated user.',
  })
  async updatePayment(@Request() req: any, @Body() body: UpdatePaymentDto): Promise<OnboardingResponseDto> {
    return this.service.updatePaymentForUser(req.user, body.payment);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update an onboarding participant' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'Participant not found.',
  })
  async update(@Param('id') id: string, @Body() body: UpdateOnboardingDto): Promise<OnboardingResponseDto> {
    return this.service.updateParticipant(id, body);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Activate a business onboarding participant' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'Participant not found or integration missing.',
  })
  async activate(@Param('id') id: string): Promise<OnboardingResponseDto> {
    return this.service.activateParticipant(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete an onboarding participant' })
  @ApiResponse({ status: 200, description: 'Participant deleted' })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'Participant not found.',
  })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    await this.service.deleteParticipant(id);
    return { message: 'Participant deleted successfully' };
  }

  @Patch(':id/webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update the webhook URL for a participant integration' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'Authentication token is missing or invalid.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'Participant not found.',
  })
  async updateWebhook(@Param('id') id: string, @Body() body: UpdateWebhookDto): Promise<OnboardingResponseDto> {
    return this.service.updateWebhook(id, body.webhookUrl);
  }

  @Patch('payment/activate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Activate a pending payout destination using the generated secret' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'The payment activation secret is invalid or expired.' })
  async activatePayment(@Request() req: any, @Body() body: ActivatePaymentDto): Promise<OnboardingResponseDto> {
    this.logger.log(`activatePayment endpoint invoked for authenticated user email=${req.user?.email ?? 'unknown'} sub=${req.user?.sub ?? 'unknown'}`);
    return this.service.activatePayment(req.user, { paymentActivationSecret: body.paymentActivationSecret });
  }
}
