import { boolean, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { pgTable } from 'drizzle-orm/pg-core';

type JsonObject = Record<string, unknown>;

export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey(),
    ruleName: text('rule_name').notNull(),
    enabled: boolean('enabled').notNull(),
    source: text('source'),
    minimumSeverity: text('minimum_severity')
      .$type<'critical' | 'high' | 'medium' | 'low'>()
      .notNull(),
    errorCode: text('error_code'),
    notificationChannel: text('notification_channel').$type<'zalo' | 'email'>().notNull(),
    destinationReference: text('destination_reference').notNull(),
    dedupWindowSeconds: integer('dedup_window_seconds').notNull(),
    escalationAfterSeconds: integer('escalation_after_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('alert_rules_enabled_idx').on(table.enabled, table.minimumSeverity)]
);

export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: uuid('id').primaryKey(),
    issueId: uuid('issue_id').notNull(),
    alertRuleId: uuid('alert_rule_id'),
    deliveryKind: text('delivery_kind')
      .$type<'new' | 'digest' | 'escalation' | 'resolved' | 'regressed'>()
      .notNull(),
    notificationChannel: text('notification_channel').$type<'zalo' | 'email'>().notNull(),
    dedupKey: text('dedup_key').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    failureCode: text('failure_code'),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('alert_deliveries_issue_requested_idx').on(table.issueId, table.requestedAt)]
);
