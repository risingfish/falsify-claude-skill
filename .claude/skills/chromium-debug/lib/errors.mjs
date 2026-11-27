// Errors that carry a stable code into the JSON output.
export const CODES = [
  'NO_SESSION', 'SESSION_ACTIVE', 'BROWSER_CHOICE_REQUIRED', 'LAUNCH_FAILED',
  'NO_PAGE', 'NO_MATCH', 'AMBIGUOUS_MATCH', 'BAD_ARGS', 'UNKNOWN_COMMAND', 'TIMEOUT',
  'BROWSER_ERROR', 'CONFIG_MISSING', 'CONFIG_INVALID', 'DEPS_MISSING', 'EXE_NOT_FOUND', 'IO_ERROR',
];

export class CmdError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function toErrorPayload(err) {
  if (err instanceof CmdError) {
    return { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  }
  if (err?.name === 'TimeoutError') return { code: 'TIMEOUT', message: err.message.split('\n')[0] };
  return { code: 'BROWSER_ERROR', message: String(err?.message || err).split('\n')[0] };
}
