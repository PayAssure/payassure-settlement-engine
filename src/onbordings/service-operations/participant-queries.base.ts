import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { PublicOnboardingResponseDto } from '../dto/public-onboarding-response.dto';
import { OnbordingsParticipantCreationBase } from './participant-creation.base';

export abstract class OnbordingsParticipantQueriesBase extends OnbordingsParticipantCreationBase {
  async findAllParticipants(): Promise<PublicOnboardingResponseDto[]> {
    const participants = await this.repository.findAllParticipants();
    return participants.map((participant) => this.toPublicResponse(participant));
  }

  async findParticipantById(id: string): Promise<OnboardingResponseDto> {
    const participant = await this.repository.findParticipantById(id);
    if (!participant) throw new NotFoundException('Participant not found');
    return this.toResponse(participant);
  }

  async findParticipantByAuthenticatedUser(user: any): Promise<OnboardingResponseDto> {
    const email = user?.email;
    if (!email) throw new UnauthorizedException('Authenticated user email is required');
    const participant = await this.repository.findParticipantByEmail(email);
    if (!participant) throw new NotFoundException('Onboarding participant not found for the authenticated user');
    return this.toResponse(participant);
  }
}
