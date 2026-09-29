import { Injectable, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../onbordings/email.service';
import { AuthRepository } from './auth.repository';
import { AuthPasswordResetBase } from './operations/password-reset.base';

@Injectable()
export class AuthService extends AuthPasswordResetBase {
  protected readonly passwordResetTokenLifetimeMs = 60 * 60 * 1000;

  constructor(
    protected readonly repository: AuthRepository,
    protected readonly jwtService: JwtService,
    @Optional() protected readonly emailService?: EmailService,
  ) {
    super();
  }
}
