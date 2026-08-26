import { index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { pgTable } from 'drizzle-orm/pg-core';

type JsonObject = Record<string, unknown>;

export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey(),
    serviceName: text('service_name').notNull(),
    releaseSha: text('release_sha').notNull(),
    buildId: text('build_id').notNull(),
    deployedAt: timestamp('deployed_at', { withTimezone: true }).notNull(),
    sourceMapVersion: text('source_map_version'),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('releases_service_deployed_idx').on(table.serviceName, table.deployedAt)]
);

export const sourceMapObjects = pgTable(
  'source_map_objects',
  {
    id: uuid('id').primaryKey(),
    releaseId: uuid('release_id').notNull(),
    objectKey: text('object_key').notNull(),
    sha256: text('sha256').notNull(),
    generatedFile: text('generated_file').notNull(),
    storageProvider: text('storage_provider').$type<'ops_object_store'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('source_map_objects_release_idx').on(table.releaseId)]
);

export const releasePublishers = pgTable(
  'release_publishers',
  {
    keyId: text('key_id').primaryKey(),
    serviceName: text('service_name').notNull(),
    secretReference: text('secret_reference').notNull(),
    status: text('status').$type<'active' | 'disabled' | 'rotated'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('release_publishers_service_status_idx').on(table.serviceName, table.status)]
);
