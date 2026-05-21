export type AppErrorCode =
  | 'network_unavailable'
  | 'tls_failed'
  | 'auth_failed'
  | 'server_rejected'
  | 'timeout'
  | 'rate_limited'
  | 'protocol_error'
  | 'db_unavailable'
  | 'keychain_unavailable'
  | 'invalid_input'
  | 'plugin_rejected'
  | 'unknown';

export type AppErrorUserAction =
  | 'retry'
  | 'reauthenticate'
  | 'check_settings'
  | 'wait'
  | 'contact_support';

export interface AppError {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  userAction: AppErrorUserAction;
  details?: string;
}

function classifyLegacyMessage(message: string): Pick<AppError, 'code' | 'retryable' | 'userAction'> {
  const lower = message.toLowerCase();
  if (lower.includes('login failed') || lower.includes('auth') || lower.includes('invalid credentials')) {
    return { code: 'auth_failed', retryable: false, userAction: 'reauthenticate' };
  }
  if (lower.includes('keychain') || lower.includes('secure storage') || lower.includes('credential')) {
    return { code: 'keychain_unavailable', retryable: false, userAction: 'reauthenticate' };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { code: 'timeout', retryable: true, userAction: 'retry' };
  }
  if (lower.includes('tls') || lower.includes('certificate') || lower.includes('handshake')) {
    return { code: 'tls_failed', retryable: false, userAction: 'check_settings' };
  }
  if (lower.includes('network') || lower.includes('connection') || lower.includes('tcp')) {
    return { code: 'network_unavailable', retryable: true, userAction: 'retry' };
  }
  return { code: 'unknown', retryable: false, userAction: 'contact_support' };
}

export function normalizeAppError(input: unknown): AppError {
  if (input && typeof input === 'object') {
    const candidate = input as Partial<AppError>;
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return {
        code: candidate.code as AppErrorCode,
        message: candidate.message,
        retryable: Boolean(candidate.retryable),
        userAction: candidate.userAction ?? 'contact_support',
        details: candidate.details,
      };
    }
  }

  const message = input instanceof Error ? input.message : String(input);
  return {
    ...classifyLegacyMessage(message),
    message,
  };
}
