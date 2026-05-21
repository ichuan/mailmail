import { describe, expect, it } from 'vitest';
import { normalizeAppError } from '../../core/app-error';

describe('normalizeAppError', () => {
  it('preserves structured app errors', () => {
    const error = normalizeAppError({
      code: 'auth_failed',
      message: 'Login failed',
      retryable: false,
      userAction: 'reauthenticate',
    });

    expect(error.code).toBe('auth_failed');
    expect(error.retryable).toBe(false);
    expect(error.userAction).toBe('reauthenticate');
  });

  it('classifies legacy string errors', () => {
    expect(normalizeAppError('Login failed: invalid credentials').code).toBe('auth_failed');
    expect(normalizeAppError('TCP connection timed out').code).toBe('timeout');
    expect(normalizeAppError('No matching entry in secure storage').code).toBe('keychain_unavailable');
  });
});
