import { Body, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { UpdateOnboardingDto } from '../dto/update-onboarding.dto';
import { OnbordingsCreateControllerBase } from './create.controller.base';

export abstract class OnbordingsParticipantDetailsControllerBase extends OnbordingsCreateControllerBase {
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get an onboarding participant by id' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Participant not found.' })
  async findOne(@Param('id') id: string): Promise<OnboardingResponseDto> {
    return this.service.findParticipantById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update an onboarding participant' })
  @ApiResponse({ status: 200, type: OnboardingResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Participant not found.' })
  async update(@Param('id') id: string, @Body() body: UpdateOnboardingDto): Promise<OnboardingResponseDto> {
    return this.service.updateParticipant(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete an onboarding participant' })
  @ApiResponse({ status: 200, description: 'Participant deleted' })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Participant not found.' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    await this.service.deleteParticipant(id);
    return { message: 'Participant deleted successfully' };
  }
}
