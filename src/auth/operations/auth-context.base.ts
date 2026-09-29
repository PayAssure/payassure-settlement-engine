import type { JwtService } from '@nestjs/jwt';
import type { EmailService } from '../../onbordings/email.service';
import type { AuthRepository } from '../auth.repository';

export abstract class AuthContextBase {
  protected abstract readonly repository: AuthRepository;
  protected abstract readonly jwtService: JwtService;
  protected abstract readonly emailService?: EmailService;
  protected abstract readonly passwordResetTokenLifetimeMs: number;
}
