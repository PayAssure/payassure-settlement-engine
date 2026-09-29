import type { AuthService } from '../auth.service';

export abstract class AuthControllerContextBase {
  protected abstract readonly authService: AuthService;
}
