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
    storageProvider: text('storage_provider').$type<'ops_object_store'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('source_map_objects_release_idx').on(table.releaseId)]
);
