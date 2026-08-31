import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const schemaVersionPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[A-Za-z0-9._-]+)?$/u;
const stableIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const variableNamePattern = /^[A-Z][A-Z0-9_]*$/u;

const stableIdSchema = z.string().regex(stableIdPattern, 'Stable IDs must be lowercase dotted identifiers');
const variableNameSchema = z
  .string()
  .regex(variableNamePattern, 'Variable names must use uppercase underscore syntax');
const nonEmptyTextSchema = z.string().min(1).max(512);

function addUniqueIdIssue(
  context: z.RefinementCtx,
  values: readonly { id: string }[],
  path: (string | number)[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate id "${value.id}"`,
        path
      });
      return;
    }
    seen.add(value.id);
  }
}

export const SensitivitySchema = z.enum(['public', 'internal', 'secret']);
export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const RequirementSchema = z.enum(['required', 'optional', 'unknown']);
export type Requirement = z.infer<typeof RequirementSchema>;

const CatalogRequirementSchema = z.enum(['required', 'optional']);

export const MutabilitySchema = z.enum(['managed', 'observed']);
export type Mutability = z.infer<typeof MutabilitySchema>;

export const CategorySchema = z.enum([
  'database',
  'auth_security',
  'payments',
  'storage',
  'integrations',
  'telemetry',
  'backup_jobs',
  'feature_flags',
  'email_notifications',
  'runtime_networking',
  'build_public_frontend'
]);
export type Category = z.infer<typeof CategorySchema>;

export const ApplyStrategySchema = z.enum([
  'no_runtime_action',
  'next_job',
  'runtime_restart',
  'credential_restart',
  'build_redeploy'
]);
export type ApplyStrategy = z.infer<typeof ApplyStrategySchema>;

const urlValidatorSchema = z
  .object({
    id: stableIdSchema,
    type: z.literal('url'),
    allowedSchemes: z.array(stableIdSchema).min(1)
  })
  .strict();
const integerValidatorSchema = z
  .object({
    id: stableIdSchema,
    type: z.literal('integer'),
    minimum: z.number().int().optional(),
    maximum: z.number().int().optional()
  })
  .strict();
const enumValidatorSchema = z
  .object({
    id: stableIdSchema,
    type: z.literal('enum'),
    allowedValues: z.array(nonEmptyTextSchema).min(1)
  })
  .strict();
const regexValidatorSchema = z
  .object({
    id: stableIdSchema,
    type: z.literal('regex'),
    pattern: z.string().min(1),
    flags: z.string().regex(/^[dgimsuvy]*$/u).optional()
  })
  .strict();
const nonEmptyValidatorSchema = z
  .object({
    id: stableIdSchema,
    type: z.literal('non_empty')
  })
  .strict();
const jsonValidatorSchema = z
  .object({
    id: stableIdSchema,
    type: z.literal('json')
  })
  .strict();

export const ValidatorSchema = z.discriminatedUnion('type', [
  urlValidatorSchema,
  integerValidatorSchema,
  enumValidatorSchema,
  regexValidatorSchema,
  nonEmptyValidatorSchema,
  jsonValidatorSchema
]);
export type Validator = z.infer<typeof ValidatorSchema>;

export const ConsumerSchema = z
  .object({
    id: stableIdSchema,
    appId: stableIdSchema,
    kind: z.enum(['service', 'job', 'build', 'credential', 'integration']),
    displayName: nonEmptyTextSchema
  })
  .strict();
export type Consumer = z.infer<typeof ConsumerSchema>;

export const PrecedenceSchema = z
  .object({
    id: stableIdSchema,
    rank: z.number().int().nonnegative(),
    scope: z.enum(['runtime', 'build', 'credential']),
    description: nonEmptyTextSchema
  })
  .strict();
export type Precedence = z.infer<typeof PrecedenceSchema>;

export const CatalogEntrySchema = z
  .object({
    id: stableIdSchema,
    name: variableNameSchema,
    appId: stableIdSchema,
    sourceId: stableIdSchema,
    consumerIds: z.array(stableIdSchema).min(1),
    category: CategorySchema,
    description: nonEmptyTextSchema,
    displayName: nonEmptyTextSchema.optional(),
    sensitivity: SensitivitySchema,
    requirement: CatalogRequirementSchema,
    mutability: MutabilitySchema,
    applyStrategy: ApplyStrategySchema,
    validatorId: stableIdSchema.optional(),
    precedenceId: stableIdSchema,
    buildAllowed: z.boolean().default(false)
  })
  .strict();
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogSchema = z
  .object({
    catalogVersion: z.string().regex(schemaVersionPattern, 'Catalog version is invalid'),
    entries: z.array(CatalogEntrySchema),
    validators: z.array(ValidatorSchema),
    consumers: z.array(ConsumerSchema),
    precedences: z.array(PrecedenceSchema)
  })
  .strict()
  .superRefine((catalog, context) => {
    addUniqueIdIssue(context, catalog.entries, ['entries']);
    addUniqueIdIssue(context, catalog.validators, ['validators']);
    addUniqueIdIssue(context, catalog.consumers, ['consumers']);
    addUniqueIdIssue(context, catalog.precedences, ['precedences']);

    const consumerIds = new Set(catalog.consumers.map((consumer) => consumer.id));
    const validatorIds = new Set(catalog.validators.map((validator) => validator.id));
    const precedenceIds = new Set(catalog.precedences.map((precedence) => precedence.id));

    catalog.entries.forEach((entry, index) => {
      for (const consumerId of entry.consumerIds) {
        if (!consumerIds.has(consumerId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown consumer "${consumerId}"`,
            path: ['entries', index, 'consumerIds']
          });
        }
      }

      if (entry.validatorId && !validatorIds.has(entry.validatorId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown validator "${entry.validatorId}"`,
          path: ['entries', index, 'validatorId']
        });
      }

      if (!precedenceIds.has(entry.precedenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown precedence "${entry.precedenceId}"`,
          path: ['entries', index, 'precedenceId']
        });
      }
    });
  });
export type Catalog = z.infer<typeof CatalogSchema>;

export function parseCatalog(text: string): Catalog {
  return CatalogSchema.parse(parseYaml(text));
}
