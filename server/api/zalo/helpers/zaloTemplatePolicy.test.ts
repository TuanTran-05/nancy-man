import { describe, expect, it } from 'vitest';
import {
  createZaloPayloadSnapshot,
  isSensitiveZaloTemplate,
  normalizeAndValidateTemplateData,
} from './zaloTemplatePolicy.js';

const params = [
  {
    name: 'student_name',
    require: true,
    type: 'STRING',
    minLength: 2,
    maxLength: 40,
    acceptNull: false,
  },
  {
    name: 'amount',
    require: true,
    type: 'NUMBER',
    minLength: 1,
    maxLength: 12,
    acceptNull: false,
  },
];

describe('Zalo template policy', () => {
  it('coerces numeric fields and returns validated data', () => {
    expect(
      normalizeAndValidateTemplateData(params, {
        student_name: 'Nguyễn An',
        amount: '1250000',
      })
    ).toEqual({
      ok: true,
      data: { student_name: 'Nguyễn An', amount: 1250000 },
    });
  });

  it('reports missing, short, long, and invalid numeric values', () => {
    expect(normalizeAndValidateTemplateData(params, { student_name: 'A', amount: 'abc' })).toEqual({
      ok: false,
      errors: ['student_name phải có ít nhất 2 ký tự.', 'amount phải là một số hợp lệ.'],
    });
  });

  it('blocks configured secret templates and secret parameter names', () => {
    expect(
      isSensitiveZaloTemplate(
        { templateId: 'otp-id', listParams: [] },
        { otpTemplateId: 'otp-id', staffTemplateId: 'staff-id' }
      )
    ).toBe(true);
    expect(
      isSensitiveZaloTemplate(
        {
          templateId: 'unknown-id',
          listParams: [{ ...params[0], name: 'pass_word' }],
        },
        { otpTemplateId: 'otp-id', staffTemplateId: 'staff-id' }
      )
    ).toBe(true);
  });

  it('redacts secrets but preserves operational variables in a snapshot', () => {
    expect(
      createZaloPayloadSnapshot({
        templateId: 'template-1',
        templateName: 'Thông báo tài khoản',
        phone: '84901234567',
        templateData: {
          student_code: 'HV001',
          pass_word: 'secret-value',
          access_token: 'token-value',
        },
        capturedAt: '2026-08-11T10:00:00.000Z',
      })
    ).toEqual({
      schemaVersion: 1,
      templateId: 'template-1',
      templateName: 'Thông báo tài khoản',
      phone: '84901234567',
      templateData: {
        student_code: 'HV001',
        pass_word: '[REDACTED]',
        access_token: '[REDACTED]',
      },
      capturedAt: '2026-08-11T10:00:00.000Z',
      redactedFields: ['pass_word', 'access_token'],
    });
  });
});
