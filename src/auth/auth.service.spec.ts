import assert = require('node:assert/strict');
import test = require('node:test');
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

function createService() {
  const user = {
    id: 'user-1',
    username: 'merchant-user',
    email: 'merchant@example.com',
    isActive: true,
    passwordHash: 'old-hash',
    refreshTokenVersion: 0,
  };
  let storedToken: any = null;
  let sentEmail: any = null;

  const repository = {
    findByEmail: async (email: string) => (email === user.email ? user : null),
    deletePasswordResetTokens: async () => {
      storedToken = null;
    },
    createPasswordResetToken: async (data: any) => {
      storedToken = { id: 'reset-1', ...data, usedAt: null, user };
      return storedToken;
    },
    findPasswordResetToken: async (tokenHash: string) => (storedToken?.tokenHash === tokenHash ? storedToken : null),
    consumePasswordResetToken: async (id: string) => {
      if (!storedToken || storedToken.id !== id || storedToken.usedAt) {
        return { count: 0 };
      }
      storedToken.usedAt = new Date();
      return { count: 1 };
    },
    updatePassword: async (_userId: string, passwordHash: string) => {
      user.passwordHash = passwordHash;
      return user;
    },
    incrementRefreshTokenVersion: async () => {
      user.refreshTokenVersion += 1;
      return user;
    },
  };

  const emailService = {
    sendPasswordResetEmail: async (data: any) => {
      sentEmail = data;
    },
  };

  return {
    service: new AuthService(repository as any, {} as any, emailService as any),
    user,
    get storedToken() {
      return storedToken;
    },
    get sentEmail() {
      return sentEmail;
    },
  };
}

test('forgot password sends a token without exposing it in the HTTP response', async () => {
  const context = createService();

  const response = await context.service.requestPasswordReset('merchant@example.com');

  assert.deepEqual(response, {
    message: 'If an account exists for that email, a password reset OTP has been sent.',
  });
  assert.equal(context.sentEmail.email, 'merchant@example.com');
  assert.match(context.sentEmail.otp, /^\d{6}$/);
  assert.notEqual(context.sentEmail.otp, context.storedToken.tokenHash);
});

test('forgot password returns the same response for an unknown email', async () => {
  const context = createService();

  const response = await context.service.requestPasswordReset('unknown@example.com');

  assert.deepEqual(response, {
    message: 'If an account exists for that email, a password reset OTP has been sent.',
  });
  assert.equal(context.sentEmail, null);
});

test('reset password consumes the token, hashes the password, and revokes refresh sessions', async () => {
  const context = createService();
  await context.service.requestPasswordReset('merchant@example.com');

  const response = await context.service.resetPassword(context.sentEmail.otp, 'new-password');

  assert.deepEqual(response, {
    message: 'Password reset successfully. Please log in with your new password.',
  });
  assert.equal(await bcrypt.compare('new-password', context.user.passwordHash), true);
  assert.equal(context.user.refreshTokenVersion, 1);
  await assert.rejects(() => context.service.resetPassword(context.sentEmail.otp, 'another-password'), /Invalid or expired password reset OTP/);
});

test('login issues access tokens for 3 minutes and refresh tokens for 30 minutes', async () => {
  const user = {
    id: 'user-1',
    username: 'merchant-user',
    email: 'merchant@example.com',
    passwordHash: await bcrypt.hash('password123', 10),
    isActive: true,
    refreshTokenVersion: 0,
    role: 'USER',
  };

  const repository = {
    findByIdentifier: async (identifier: string) => (identifier === user.email || identifier === user.username ? user : null),
    linkParticipantToUser: async () => undefined,
    findOnboardedByEmail: async () => ({ id: 'participant-1', email: user.email }),
    findByEmail: async () => null,
    createUser: async () => user,
  };

  const jwtService = new JwtService({ secret: 'test-secret' });
  const service = new AuthService(repository as any, jwtService as any);

  const result = await service.login({ identifier: 'merchant@example.com', password: 'password123' });
  const accessPayload = jwtService.decode(result.accessToken) as any;
  const refreshPayload = jwtService.decode(result.refreshToken) as any;

  assert.equal(accessPayload.exp - accessPayload.iat, 180);
  assert.equal(refreshPayload.exp - refreshPayload.iat, 1800);
});

test('reset password rejects an invalid token', async () => {
  const context = createService();

  await assert.rejects(() => context.service.resetPassword('12345', 'new-password'), /Invalid or expired password reset OTP/);
});
