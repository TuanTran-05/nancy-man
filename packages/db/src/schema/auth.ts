import { customType, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { pgTable } from 'drizzle-orm/pg-core';

const byteaColumn = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea'
});

export const opsUsers = pgTable(
  'ops_users',
  {
    id: uuid('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').$type<'ops_viewer' | 'ops_maintainer' | 'ops_owner'>().notNull(),
    status: text('status').$type<'pending_mfa' | 'active' | 'locked' | 'revoked'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [index('ops_users_status_idx').on(table.status)]
);

export const opsPasswordCredentials = pgTable(
  'ops_password_credentials',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordFingerprint: text('password_fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true })
  },
  (table) => [index('ops_password_credentials_user_created_idx').on(table.userId, table.createdAt)]
);

export const opsMfaFactors = pgTable(
  'ops_mfa_factors',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    factorType: text('factor_type').$type<'webauthn' | 'totp'>().notNull(),
    encryptedSecret: byteaColumn('encrypted_secret').notNull(),
    credentialMetadata: jsonb('credential_metadata').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [index('ops_mfa_factors_user_idx').on(table.userId)]
);

export const opsRecoveryCodes = pgTable(
  'ops_recovery_codes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    replacedAt: timestamp('replaced_at', { withTimezone: true })
  },
  (table) => [index('ops_recovery_codes_user_idx').on(table.userId)]
);

export const opsSessions = pgTable(
  'ops_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    sessionHash: text('session_hash').notNull(),
    csrfSecretHash: text('csrf_secret_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    ipHash: text('ip_hash').notNull(),
    userAgent: text('user_agent').notNull()
  },
  (table) => [index('ops_sessions_user_active_idx').on(table.userId, table.idleExpiresAt)]
);
