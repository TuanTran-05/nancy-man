import { z } from 'zod';

import { DATABASE_PAGE_SIZES, DATABASE_TARGET_IDS } from './databaseExplorer.js';

const targetIdSchema = z.enum(DATABASE_TARGET_IDS);
const pageSizeSchema = z.union([
  z.literal(DATABASE_PAGE_SIZES[0]),
  z.literal(DATABASE_PAGE_SIZES[1]),
  z.literal(DATABASE_PAGE_SIZES[2])
]);
const identifierSchema = z.string().min(1).max(128);
const cursorSchema = z.string().min(1).max(4096);
const piiModeSchema = z.enum(['masked', 'revealed']);

interface JsonObject {
  [key: string]: JsonValue;
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor?.enumerable === true &&
      descriptor.get === undefined &&
      descriptor.set === undefined
    );
  });
}

function isJsonValue(value: unknown): value is JsonValue {
  const active = new WeakSet<object>();
  const pending: Array<{ value: unknown; exit?: boolean }> = [{ value }];

  try {
    while (pending.length > 0) {
      const item = pending.pop()!;
      if (item.exit) {
        active.delete(item.value as object);
        continue;
      }

      const current = item.value;
      if (
        current === null ||
        typeof current === 'boolean' ||
        typeof current === 'string' ||
        (typeof current === 'number' && Number.isFinite(current))
      ) {
        continue;
      }
      if (typeof current !== 'object') return false;
      if (active.has(current)) return false;

      active.add(current);
      pending.push({ value: current, exit: true });
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) return false;
        const ownKeys = Reflect.ownKeys(current);
        if (ownKeys.length !== current.length + 1 || !ownKeys.includes('length')) return false;
        for (let index = current.length - 1; index >= 0; index--) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (
            !descriptor?.enumerable ||
            descriptor.get !== undefined ||
            descriptor.set !== undefined
          ) {
            return false;
          }
          pending.push({ value: descriptor.value });
        }
        continue;
      }
      if (!isPlainJsonObject(current)) return false;
      const keys = Reflect.ownKeys(current) as string[];
      for (let index = keys.length - 1; index >= 0; index--) {
        pending.push({ value: Object.getOwnPropertyDescriptor(current, keys[index]!)!.value });
      }
    }
    return true;
  } catch {
    return false;
  }
}

const jsonValueSchema = z.custom<JsonValue>(isJsonValue);

export const databaseTargetsPayloadSchema = z.object({}).strict();

export const databaseSchemaPayloadSchema = z.object({ targetId: targetIdSchema }).strict();

const filterSchema = z
  .object({
    column: identifierSchema,
    operator: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']),
    value: z.string().max(200).optional()
  })
  .strict();

export const databaseRowsPayloadSchema = z
  .object({
    targetId: targetIdSchema,
    schema: identifierSchema,
    relation: identifierSchema,
    pageSize: pageSizeSchema,
    cursor: cursorSchema.optional(),
    sort: z
      .object({ column: identifierSchema, direction: z.enum(['asc', 'desc']) })
      .strict()
      .optional(),
    filters: z.array(filterSchema).max(5),
    piiMode: piiModeSchema
  })
  .strict();

export const databaseRelatedRowsPayloadSchema = z
  .object({
    targetId: targetIdSchema,
    schema: identifierSchema,
    relation: identifierSchema,
    constraint: identifierSchema,
    rowRef: cursorSchema,
    pageSize: pageSizeSchema,
    cursor: cursorSchema.optional(),
    piiMode: piiModeSchema
  })
  .strict();

const targetSummarySchema = z
  .object({
    id: targetIdSchema,
    label: z.string().min(1).max(128),
    description: z.string().max(512).optional(),
    status: z.enum(['available', 'unavailable', 'disabled']),
    readOnly: z.literal(true),
    unavailableReason: z.string().min(1).max(80).optional()
  })
  .strict();

export const databaseTargetsResultSchema = z
  .array(targetSummarySchema)
  .length(DATABASE_TARGET_IDS.length)
  .superRefine((targets, context) => {
    const ids = new Set(targets.map((target) => target.id));
    if (ids.size !== DATABASE_TARGET_IDS.length || DATABASE_TARGET_IDS.some((id) => !ids.has(id))) {
      context.addIssue({
        code: 'custom',
        message: 'Target summaries must contain the closed target set'
      });
    }
  });

const databaseColumnSchema = z
  .object({
    name: identifierSchema,
    dataType: z.string().min(1).max(256),
    nullable: z.boolean(),
    hasDefault: z.boolean(),
    identity: z.enum(['always', 'by_default']).nullable(),
    generated: z.boolean(),
    classification: z.enum(['public', 'internal', 'pii', 'blocked']),
    selectable: z.boolean(),
    filterOperators: z.array(
      z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'])
    )
  })
  .strict();

const databaseConstraintSchema = z
  .object({
    name: identifierSchema,
    kind: z.enum(['primary_key', 'unique', 'foreign_key', 'check']),
    columns: z.array(identifierSchema),
    referencedRelation: z
      .object({
        schema: identifierSchema,
        name: identifierSchema,
        columns: z.array(identifierSchema)
      })
      .strict()
      .nullable(),
    deferrable: z.boolean(),
    initiallyDeferred: z.boolean()
  })
  .strict();

const databaseIndexSchema = z
  .object({
    name: identifierSchema,
    method: z.string().min(1).max(128),
    columns: z.array(identifierSchema),
    unique: z.boolean(),
    primary: z.boolean(),
    valid: z.boolean(),
    hasExpressions: z.boolean(),
    partial: z.boolean()
  })
  .strict();

const databaseTriggerSchema = z
  .object({
    name: identifierSchema,
    timing: z.enum(['before', 'after', 'instead_of']),
    events: z.array(z.enum(['insert', 'update', 'delete', 'truncate'])),
    enabled: z.enum(['enabled', 'disabled', 'replica', 'always'])
  })
  .strict();

const databasePolicySchema = z
  .object({
    name: identifierSchema,
    command: z.enum(['all', 'select', 'insert', 'update', 'delete']),
    permissive: z.boolean(),
    roles: z.array(z.string().min(1).max(128))
  })
  .strict();

const relationEdgeSchema = z
  .object({
    constraint: identifierSchema,
    from: z
      .object({
        schema: identifierSchema,
        relation: identifierSchema,
        columns: z.array(identifierSchema)
      })
      .strict(),
    to: z
      .object({
        schema: identifierSchema,
        relation: identifierSchema,
        columns: z.array(identifierSchema)
      })
      .strict()
  })
  .strict();

const explorerRelationSchema = z
  .object({
    name: identifierSchema,
    kind: z.enum(['table', 'partitioned_table', 'view', 'materialized_view', 'foreign_table']),
    rowLevelSecurity: z.object({ enabled: z.boolean(), forced: z.boolean() }).strict(),
    columns: z.array(databaseColumnSchema),
    constraints: z.array(databaseConstraintSchema),
    indexes: z.array(databaseIndexSchema),
    triggers: z.array(databaseTriggerSchema),
    policies: z.array(databasePolicySchema),
    estimatedRows: z.number().finite().nonnegative().nullable(),
    dataAvailable: z.boolean(),
    primaryKey: z.array(identifierSchema).nullable(),
    paginationKey: z.array(identifierSchema).nullable()
  })
  .strict();

export const databaseSchemaResultSchema = z
  .object({
    targetId: targetIdSchema,
    targetLabel: z.string().min(1).max(128),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    policyVersion: z.string().min(1).max(128),
    schemas: z.array(
      z.object({ name: identifierSchema, relations: z.array(explorerRelationSchema) }).strict()
    ),
    edges: z.array(relationEdgeSchema)
  })
  .strict();

const databaseCellSchema = z.union([
  z.object({ state: z.literal('value'), value: jsonValueSchema }).strict(),
  z.object({ state: z.literal('masked'), display: z.string() }).strict(),
  z.object({ state: z.literal('blocked') }).strict(),
  z
    .object({
      state: z.literal('truncated'),
      display: z.string(),
      originalBytes: z.number().int().nonnegative()
    })
    .strict()
]);

export const databaseRowsResultSchema = z
  .object({
    targetId: targetIdSchema,
    schemaChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    policyVersion: z.string().min(1).max(128),
    schema: identifierSchema,
    relation: identifierSchema,
    columns: z.array(databaseColumnSchema),
    rows: z.array(
      z
        .object({
          rowRef: z.string().min(1).max(4096).nullable(),
          cells: z.record(z.string(), databaseCellSchema)
        })
        .strict()
    ),
    nextCursor: cursorSchema.nullable(),
    truncated: z.boolean(),
    encodedBytes: z.number().int().nonnegative(),
    consistency: z.enum(['stable', 'best_effort']),
    piiMode: piiModeSchema
  })
  .strict();

export const databaseExplorerCommandSchemas = {
  'database.targets': {
    payload: databaseTargetsPayloadSchema,
    result: databaseTargetsResultSchema
  },
  'database.schema': {
    payload: databaseSchemaPayloadSchema,
    result: databaseSchemaResultSchema
  },
  'database.rows': {
    payload: databaseRowsPayloadSchema,
    result: databaseRowsResultSchema
  },
  'database.relatedRows': {
    payload: databaseRelatedRowsPayloadSchema,
    result: databaseRowsResultSchema
  }
} as const;
