import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthUsersControllerBase } from './controllers/auth-users.controller.base';

@ApiTags('auth')
@Controller('auth')
export class AuthController extends AuthUsersControllerBase {
  constructor(protected readonly authService: AuthService) {
    super();
  }
}
