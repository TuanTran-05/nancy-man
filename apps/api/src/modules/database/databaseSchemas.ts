import { z } from 'zod';
import { DATABASE_TARGET_IDS } from '../../../../../packages/contracts/src/databaseExplorer.js';

export const TargetIdParamSchema = z.enum(DATABASE_TARGET_IDS);

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(63)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f-\u009f]+$/, 'Control characters are forbidden in identifiers');

export const PageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)]);

export const FilterOperatorSchema = z.enum([
  'eq',
  'neq',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_null',
  'is_not_null'
]);

export const FilterItemSchema = z
  .object({
    column: IdentifierSchema,
    operator: FilterOperatorSchema,
    value: z.string().max(200).optional()
  })
  .strict();

export const SortDirectionSchema = z.enum(['asc', 'desc']);

export const SortItemSchema = z
  .object({
    column: IdentifierSchema,
    direction: SortDirectionSchema
  })
  .strict();

export const CursorSchema = z.string().min(1).max(4096);
export const RowRefSchema = z.string().min(1).max(4096);

export const DatabaseRowsQueryBodySchema = z
  .object({
    schema: IdentifierSchema,
    relation: IdentifierSchema,
    pageSize: PageSizeSchema.default(25),
    cursor: CursorSchema.optional(),
    sort: SortItemSchema.optional(),
    filters: z.array(FilterItemSchema).max(5).default([]),
    piiMode: z.enum(['masked', 'revealed']).default('masked')
  })
  .strict();

export const DatabaseRelatedRowsQueryBodySchema = z
  .object({
    schema: IdentifierSchema,
    relation: IdentifierSchema,
    constraint: z.string().min(1).max(128),
    rowRef: RowRefSchema,
    pageSize: PageSizeSchema.default(25),
    cursor: CursorSchema.optional(),
    piiMode: z.enum(['masked', 'revealed']).default('masked')
  })
  .strict();

export const DatabasePiiRevealBodySchema = z
  .object({
    password: z.string().min(1).max(256),
    token: z.string().regex(/^\d{6}$/, 'TOTP token must be 6 digits'),
    reason: z.string().min(10).max(500)
  })
  .strict();

export const DatabasePiiRevealRequestSchema = DatabasePiiRevealBodySchema.extend({
  targetId: TargetIdParamSchema
}).strict();
