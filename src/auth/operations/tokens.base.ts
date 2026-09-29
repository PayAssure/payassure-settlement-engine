import { AuthProfileBase } from './profile.base';

export abstract class AuthTokensBase extends AuthProfileBase {
  protected async issueTokens(user: any) {
    const profileStatus = await this.getProfileStatus(user.email);
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      version: user.refreshTokenVersion,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '3m' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '30m' });

    return {
      accessToken,
      refreshToken,
      profileComplete: profileStatus.profileComplete,
      message: profileStatus.message,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  }
}
