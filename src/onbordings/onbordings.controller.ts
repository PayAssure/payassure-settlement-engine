import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { OnboardingResponseDto } from './dto/onboarding-response.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { OnbordingsService } from './onbordings.service';

@ApiTags('onbordings')
@Controller('onbordings')
export class OnbordingsController {
  constructor(private readonly service: OnbordingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a retailer or supplier onboarding record and generate credentials' })
  @ApiResponse({ status: 201, type: OnboardingResponseDto })
  async create(@Body() body: CreateOnboardingDto): Promise<OnboardingResponseDto> {
    return this.service.createParticipant(body);
  }

  @Get()
  @ApiOperation({ summary: 'List onboarding participants' })
  @ApiResponse({ status: 200, type: [OnboardingResponseDto] })
  async findAll(): Promise<OnboardingResponseDto[]> {
    return this.service.findAllParticipants();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an onboarding participant by id' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  async findOne(@Param('id') id: string): Promise<OnboardingResponseDto> {
    return this.service.findParticipantById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an onboarding participant' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  async update(@Param('id') id: string, @Body() body: UpdateOnboardingDto): Promise<OnboardingResponseDto> {
    return this.service.updateParticipant(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an onboarding participant' })
  @ApiResponse({ status: 200, description: 'Participant deleted' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    await this.service.deleteParticipant(id);
    return { message: 'Participant deleted successfully' };
  }

  @Patch(':id/webhook')
  @ApiOperation({ summary: 'Update the webhook URL for a participant integration' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  async updateWebhook(@Param('id') id: string, @Body() body: UpdateWebhookDto): Promise<OnboardingResponseDto> {
    return this.service.updateWebhook(id, body.webhookUrl);
  }

  @Post(':id/integrations')
  @ApiOperation({ summary: 'Create a new integration for a participant' })
  @ApiResponse({ status: 201, description: 'Integration created' })
  async createIntegration(@Param('id') id: string, @Body() body: CreateIntegrationDto) {
    return this.service.createIntegration(id, body);
  }
}
