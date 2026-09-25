import { describe, expect, it } from 'vitest';

import { classifyColumn, DATABASE_POLICY_VERSION, maskPiiValue } from './columnPolicy.js';

describe('Column policy classification and masking', () => {
  it.each([
    ['edutrack_production', 'public', 'zalo_config', 'access_token'],
    ['edutrack_production', 'public', 'staff_password_credentials', 'password_hash'],
    ['edutrack_production', 'public', 'auth_otp_challenges', 'otp_hash'],
    ['edutrack_production', 'public', 'auth_sessions', 'token_hash'],
    ['ops', 'public', 'ops_mfa_factors', 'encrypted_secret'],
    ['ops', 'public', 'ops_sessions', 'csrf_secret_hash'],
    ['ops', 'public', 'sql_executions', 'original_sql_ciphertext']
  ] as const)('always blocks %s:%s.%s.%s', (targetId, schema, relation, column) => {
    expect(classifyColumn({ targetId, schema, relation, column })).toBe('blocked');
  });

  it('classifies secret and credential patterns as blocked', () => {
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'password'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'password_salt'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'user_otp'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'api_token'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'client_secret'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'credential'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'private_key'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'encryption_key'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'users',
        column: 'ciphertext'
      })
    ).toBe('blocked');
    expect(
      classifyColumn({ targetId: 'ops', schema: 'public', relation: 'sessions', column: 'csrf' })
    ).toBe('blocked');
  });

  it('classifies PII patterns as pii', () => {
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        column: 'email'
      })
    ).toBe('pii');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        column: 'phone'
      })
    ).toBe('pii');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        column: 'display_name'
      })
    ).toBe('pii');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        column: 'full_name'
      })
    ).toBe('pii');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        column: 'address'
      })
    ).toBe('pii');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'submissions',
        column: 'content'
      })
    ).toBe('pii');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'submissions',
        column: 'answer'
      })
    ).toBe('pii');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'submissions',
        column: 'comment'
      })
    ).toBe('pii');
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'webhooks',
        column: 'raw_payload'
      })
    ).toBe('pii');
  });

  it.each([
    'given_name',
    'first_name',
    'middle_name',
    'family_name',
    'last_name',
    'preferred_name',
    'legal_name',
    'date_of_birth',
    'birth_date',
    'dob',
    'mobile_number',
    'telephone_number',
    'street_address',
    'address_line_1',
    'house_number',
    'unit_number',
    'city',
    'district',
    'ward',
    'postal_code',
    'notes',
    'internal_comments',
    'messages',
    'free_form_content',
    'raw_payload'
  ])('classifies broader PII column %s as pii', (column) => {
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'records',
        column
      })
    ).toBe('pii');
  });

  it.each(['email_token', 'raw_payload_secret', 'phone_password_hash'])(
    'keeps blocked patterns ahead of PII patterns for %s',
    (column) => {
      expect(
        classifyColumn({
          targetId: 'edutrack_production',
          schema: 'public',
          relation: 'records',
          column
        })
      ).toBe('blocked');
    }
  );

  it('proves an exact public override cannot override a blocked name', () => {
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'safe_table',
        column: 'password_hash'
      })
    ).toBe('blocked');
  });

  it('defaults non-PII, non-blocked columns to internal', () => {
    expect(
      classifyColumn({
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'classes',
        column: 'code'
      })
    ).toBe('internal');
  });

  it('correctly masks emails, phone numbers, and other PII', () => {
    expect(maskPiiValue('test.user@example.com', 'email')).toBe('t***@example.com');
    expect(maskPiiValue('+84901234567', 'phone')).toBe('******4567');
    expect(maskPiiValue('Nguyen Van A', 'name')).toBe('••••••');
    expect(maskPiiValue(null)).toBe('••••••');
  });

  it('has a defined policy version', () => {
    expect(DATABASE_POLICY_VERSION).toBe('2026-09-25-v2');
  });
});
