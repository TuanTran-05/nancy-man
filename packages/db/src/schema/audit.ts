import { bigint, customType, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { pgTable } from 'drizzle-orm/pg-core';

const byteaColumn = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea'
});

export const opsAuditEntries = pgTable('ops_audit_entries', {
  auditSequence: bigint('audit_sequence', { mode: 'number' }).primaryKey(),
  id: uuid('id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id'),
  requestId: text('request_id'),
  ipHash: text('ip_hash'),
  metadata: jsonb('metadata').notNull(),
  previousHash: text('previous_hash'),
  entryHash: text('entry_hash').notNull()
});

export const opsAuditCheckpoints = pgTable('ops_audit_checkpoints', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  auditSequence: bigint('audit_sequence', { mode: 'number' }).notNull(),
  entryHash: text('entry_hash').notNull(),
  signature: byteaColumn('signature').notNull(),
  signerKeyId: text('signer_key_id').notNull(),
  exportedAt: timestamp('exported_at', { withTimezone: true }),
  offHostObjectKey: text('off_host_object_key')
});
