import { describe, expect, it } from 'vitest';

import { classifySeverity } from './classifySeverity.js';

describe('classifySeverity', () => {
  it('marks availability, authentication, data-loss and recovery failures critical', () => {
    for (const errorCode of ['DB_UNAVAILABLE', 'LOGIN_UNAVAILABLE', 'DATA_LOSS_DETECTED', 'PITR_FAILED']) {
      expect(classifySeverity({ source: 'database', errorCode })).toBe('critical');
    }
  });

  it('marks financial/core multi-user failures high and isolated retryable failures medium', () => {
    expect(
      classifySeverity({ source: 'api', errorCode: 'INVOICE_JOB_FAILED', affectedUsers: 8 })
    ).toBe('high');
    expect(classifySeverity({ source: 'browser', errorCode: 'STUDENT_LOAD_FAILED', retryable: true })).toBe(
      'medium'
    );
    expect(classifySeverity({ source: 'browser', errorCode: 'OPTIONAL_WIDGET_FAILED', handled: true })).toBe('low');
  });
});
