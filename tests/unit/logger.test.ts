import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logError, logInfo, logWarn, logRetry } from '../../src/utils/logger.js';

describe('Logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('logError', () => {
    it('logs with subsystem and operation prefix', () => {
      logError({
        subsystem: 'QualityDetector',
        operation: 'evaluateQuality',
        error: 'API timeout',
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, context] = errorSpy.mock.calls[0];
      expect(message).toContain('QualityDetector');
      expect(message).toContain('evaluateQuality');
      expect(context.error).toBe('API timeout');
    });

    it('extracts message from Error objects', () => {
      logError({
        subsystem: 'RewardEngine',
        operation: 'applyFlair',
        error: new Error('Permission denied'),
      });

      const [, context] = errorSpy.mock.calls[0];
      expect(context.error).toBe('Permission denied');
    });

    it('includes additional context fields', () => {
      logError({
        subsystem: 'UserTracker',
        operation: 'recordEvent',
        error: 'Redis down',
        username: 'alice',
        contentId: 't3_abc',
      });

      const [, context] = errorSpy.mock.calls[0];
      expect(context.username).toBe('alice');
      expect(context.contentId).toBe('t3_abc');
    });
  });

  describe('logInfo', () => {
    it('logs informational messages', () => {
      logInfo({
        subsystem: 'InsightAnalyzer',
        operation: 'Analysis completed',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message] = logSpy.mock.calls[0];
      expect(message).toContain('InsightAnalyzer');
    });
  });

  describe('logWarn', () => {
    it('logs warnings', () => {
      logWarn({
        subsystem: 'Settings',
        operation: 'validateSettings',
        error: 'Value out of range',
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('logRetry', () => {
    it('logs retry attempts with attempt count', () => {
      logRetry({
        subsystem: 'RedisStore',
        operation: 'zAdd',
        error: 'Connection refused',
        retryAttempt: 2,
        maxRetries: 3,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message, context] = warnSpy.mock.calls[0];
      expect(message).toContain('attempt 2/3');
      expect(context.retryAttempt).toBe(2);
      expect(context.maxRetries).toBe(3);
    });
  });
});
