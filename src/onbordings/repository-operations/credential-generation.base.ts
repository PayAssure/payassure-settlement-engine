import { createHash, randomBytes } from 'crypto';
import { OnbordingsProfileStatusBase } from './profile-status.base';

export abstract class OnbordingsCredentialGenerationBase extends OnbordingsProfileStatusBase {
  protected generateMerchantId(): string {
    return `pay_${randomBytes(8).toString('hex')}`;
  }

  protected generateCredential(prefix: string): string {
    return `${prefix}_${randomBytes(16).toString('hex')}`;
  }

  protected hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }
}
