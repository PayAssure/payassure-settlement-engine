import { NotFoundException } from '@nestjs/common';
import { OnbordingsParticipantQueriesBase } from './participant-queries.base';

export abstract class OnbordingsIntegrationCredentialsBase extends OnbordingsParticipantQueriesBase {
  async getIntegrationCredentialsByEmail(email: string, isActive?: boolean) {
    if (!email) throw new NotFoundException('User email is required');
    const activeStatus = isActive === undefined ? undefined : Boolean(isActive);
    return this.repository.findIntegrationCredentialsByEmail(email, activeStatus);
  }
}
