import type { DatabaseColumnClassification, DatabaseTargetId } from '@edutrack-ops/contracts';

export type ExactColumnTarget = {
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  column: string;
};

export const EXACT_BLOCKED_OVERRIDES: readonly ExactColumnTarget[] = [
  {
    targetId: 'edutrack_production',
    schema: 'public',
    relation: 'zalo_config',
    column: 'access_token'
  },
  {
    targetId: 'edutrack_production',
    schema: 'public',
    relation: 'zalo_config',
    column: 'refresh_token'
  },
  {
    targetId: 'edutrack_production',
    schema: 'public',
    relation: 'staff_password_credentials',
    column: 'password_hash'
  },
  {
    targetId: 'edutrack_production',
    schema: 'public',
    relation: 'auth_otp_challenges',
    column: 'otp_hash'
  },
  {
    targetId: 'edutrack_production',
    schema: 'public',
    relation: 'auth_sessions',
    column: 'token_hash'
  },
  {
    targetId: 'edutrack_production',
    schema: 'public',
    relation: 'parent_accounts',
    column: 'password_hash'
  },
  {
    targetId: 'edutrack_production',
    schema: 'public',
    relation: 'parent_accounts',
    column: 'password_salt'
  },
  { targetId: 'ops', schema: 'public', relation: 'ops_mfa_factors', column: 'encrypted_secret' },
  { targetId: 'ops', schema: 'public', relation: 'ops_sessions', column: 'csrf_secret_hash' },
  {
    targetId: 'ops',
    schema: 'public',
    relation: 'sql_executions',
    column: 'original_sql_ciphertext'
  },
  { targetId: 'ops', schema: 'public', relation: 'ops_users', column: 'password_hash' },
  { targetId: 'ops', schema: 'public', relation: 'ops_users', column: 'password_salt' },
  { targetId: 'ops', schema: 'public', relation: 'ops_enrollments', column: 'enrollment_secret' }
];

export const EXACT_PII_OVERRIDES: readonly ExactColumnTarget[] = [];

export const EXACT_PUBLIC_OVERRIDES: readonly ExactColumnTarget[] = [];

export const DATABASE_POLICY_VERSION = '2026-09-25';

function makeKey(target: ExactColumnTarget): string {
  return `${target.targetId}:${target.schema}.${target.relation}.${target.column}`.toLowerCase();
}

const blockedSet = new Set(EXACT_BLOCKED_OVERRIDES.map(makeKey));
const piiSet = new Set(EXACT_PII_OVERRIDES.map(makeKey));
const publicSet = new Set(EXACT_PUBLIC_OVERRIDES.map(makeKey));

const BLOCKED_TOKENS = [
  'password',
  'passwd',
  'salt',
  'otp',
  'token',
  'secret',
  'credential',
  'private_key',
  'encryption_key',
  'ciphertext',
  'csrf'
];

const PII_TOKENS = [
  'email',
  'phone',
  'display_name',
  'full_name',
  'address',
  'content',
  'answer',
  'comment',
  'raw_payload'
];

function isBlockedName(column: string, relation: string): boolean {
  const col = column.toLowerCase();
  const rel = relation.toLowerCase();

  if (rel === 'student_auth_credentials' && col.includes('password')) {
    return true;
  }

  for (const token of BLOCKED_TOKENS) {
    if (col === token) return true;
    if (col.startsWith(`${token}_`) || col.endsWith(`_${token}`) || col.includes(`_${token}_`)) {
      return true;
    }
  }

  return false;
}

function isPiiName(column: string): boolean {
  const col = column.toLowerCase();

  for (const token of PII_TOKENS) {
    if (col === token) return true;
    if (col.startsWith(`${token}_`) || col.endsWith(`_${token}`) || col.includes(`_${token}_`)) {
      return true;
    }
  }

  return false;
}

export function classifyColumn(input: {
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  column: string;
}): DatabaseColumnClassification {
  const key = `${input.targetId}:${input.schema}.${input.relation}.${input.column}`.toLowerCase();

  // 1. Exact blocked override
  if (blockedSet.has(key)) {
    return 'blocked';
  }

  // 2. Blocked name rule
  if (isBlockedName(input.column, input.relation)) {
    return 'blocked';
  }

  // 3. Exact PII override
  if (piiSet.has(key)) {
    return 'pii';
  }

  // 4. PII name rule
  if (isPiiName(input.column)) {
    return 'pii';
  }

  // 5. Exact public override
  if (publicSet.has(key)) {
    return 'public';
  }

  // 6. Default to internal
  return 'internal';
}

export function maskPiiValue(value: unknown, hint?: string): string {
  if (value === null || value === undefined) {
    return '••••••';
  }

  const str = String(value).trim();
  if (!str) return '••••••';

  // Email masking: first character + ***@domain
  if (hint === 'email' || (str.includes('@') && !str.includes(' '))) {
    const parts = str.split('@');
    if (parts.length === 2 && parts[0] && parts[1]) {
      const localPart = parts[0];
      const domainPart = parts[1];
      const firstChar = localPart.charAt(0);
      return `${firstChar}***@${domainPart}`;
    }
    return '••••••';
  }

  // Phone masking: at most 4 trailing digits: ******1234
  if (hint === 'phone' || /^[+]?[\d\s-]{7,15}$/.test(str)) {
    const digitsOnly = str.replace(/\D/g, '');
    if (digitsOnly.length >= 4) {
      const trailing = digitsOnly.slice(-4);
      return `******${trailing}`;
    }
    return '••••••';
  }

  return '••••••';
}
