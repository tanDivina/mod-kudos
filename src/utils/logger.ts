/**
 * Structured logging utility for ModKudos.
 *
 * Provides consistent, structured error and info logging across all
 * subsystems. Each log entry includes the subsystem name, operation,
 * relevant IDs, and retry attempt number when applicable.
 *
 * Requirements: 1.6, 2.7, 3.7, 5.6, 8.5
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid subsystem names for structured logging. */
export type Subsystem =
  | 'QualityDetector'
  | 'RewardEngine'
  | 'UserTracker'
  | 'ContextCard'
  | 'InsightAnalyzer'
  | 'Dashboard'
  | 'RedisStore'
  | 'Settings';

/** Structured log context attached to every log entry. */
export interface LogContext {
  /** The subsystem that generated the log. */
  subsystem: Subsystem;
  /** The operation that was being performed. */
  operation: string;
  /** Optional error message or Error object. */
  error?: string | Error;
  /** Optional content ID related to the log. */
  contentId?: string;
  /** Optional username related to the log. */
  username?: string;
  /** Optional retry attempt number (1-based). */
  retryAttempt?: number;
  /** Optional maximum retry attempts. */
  maxRetries?: number;
  /** Any additional context data. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Log an error with structured context.
 *
 * Formats the error message with subsystem and operation prefix,
 * and includes all context fields for debugging.
 */
export function logError(context: LogContext): void {
  const { subsystem, operation, error, ...rest } = context;
  const errorMessage = error instanceof Error ? error.message : error;

  console.error(`[${subsystem}] ${operation} failed`, {
    subsystem,
    operation,
    error: errorMessage,
    ...rest,
  });
}

/**
 * Log an informational message with structured context.
 */
export function logInfo(context: Omit<LogContext, 'error'>): void {
  const { subsystem, operation, ...rest } = context;

  console.log(`[${subsystem}] ${operation}`, {
    subsystem,
    operation,
    ...rest,
  });
}

/**
 * Log a warning with structured context.
 */
export function logWarn(context: LogContext): void {
  const { subsystem, operation, error, ...rest } = context;
  const errorMessage = error instanceof Error ? error.message : error;

  console.warn(`[${subsystem}] ${operation}`, {
    subsystem,
    operation,
    error: errorMessage,
    ...rest,
  });
}

/**
 * Log a retry attempt with structured context.
 *
 * Convenience wrapper that includes retry-specific fields.
 */
export function logRetry(
  context: LogContext & { retryAttempt: number; maxRetries: number },
): void {
  const { subsystem, operation, retryAttempt, maxRetries, error, ...rest } = context;
  const errorMessage = error instanceof Error ? error.message : error;

  console.warn(
    `[${subsystem}] ${operation} failed (attempt ${retryAttempt}/${maxRetries}), retrying...`,
    {
      subsystem,
      operation,
      retryAttempt,
      maxRetries,
      error: errorMessage,
      ...rest,
    },
  );
}
