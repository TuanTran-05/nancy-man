import { jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { pgTable, primaryKey } from 'drizzle-orm/pg-core';

export const serviceHeartbeats = pgTable(
  'service_heartbeats',
  {
    serviceName: text('service_name').notNull(),
    environment: text('environment').$type<'production'>().notNull(),
    instanceId: text('instance_id').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    releaseSha: text('release_sha'),
    status: text('status').$type<'ok' | 'degraded' | 'failed'>().notNull(),
    metadata: jsonb('metadata').notNull()
  },
  (table) => [primaryKey({ columns: [table.serviceName, table.environment, table.instanceId] })]
);
