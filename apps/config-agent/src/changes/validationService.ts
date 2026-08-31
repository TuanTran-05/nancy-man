import { readFileSync } from 'node:fs';

import {
  ChangeItemSchema,
  ChangeValidateRequestSchema,
  type Catalog,
  type CatalogEntry,
  type ChangeImpactPlan,
  type ChangeValidateRequest,
  type ManifestSource,
} from '../../../../packages/config-contracts/src/index.js';
import { DraftStore } from './draftStore.js';
import type { SafeSourceMetadata } from '../security/safeSourceFile.js';
import {
  readSafeSourceFile,
  resolveActiveReleaseLink
} from '../security/safeSourceFile.js';
import {
  parseSystemdCredentialFile,
  type CredentialDisplayEncoding
} from '../adapters/systemdCredentialFile.js';
import { dotenvFileAdapter } from '../adapters/dotenvFile.js';
import { nodeEnvFileAdapter } from '../adapters/nodeEnvFile.js';
import { systemdEnvironmentFileAdapter } from '../adapters/systemdEnvironmentFile.js';
import { pm2EcosystemStaticAdapter } from '../adapters/pm2EcosystemStatic.js';
import {
  serializeUpdatedSource,
  type ParsedSource,
  type SourceWriteOperation
} from '../adapters/types.js';
import {
  fingerprintSource,
  fingerprintValue,
  hmacFingerprint,
  type FingerprintKey
} from '../inventory/fingerprint.js';

export type ValidationSourceRead = Readonly<{
  bytes: Buffer;
  metadata: SafeSourceMetadata;
}>;

export type ValidationSourceReader = (
  source: ManifestSource
) => ValidationSourceRead | Promise<ValidationSourceRead>;

export type ValidationApplicationContext = Readonly<{
  appId: string;
  changeId: string;
  sourceIds: readonly string[];
  proposedSourceBytes: Readonly<Record<string, Buffer>>;
}>;

export type ValidationServiceOptions = Readonly<{
  catalog: Catalog;
  manifest: Readonly<{
    manifestVersion: string;
    catalogVersion: string;
    sources: readonly ManifestSource[];
  }>;
  fingerprintKey: FingerprintKey;
  draftStore: Pick<DraftStore, 'replaceDraft'>;
  readSource?: ValidationSourceReader;
  credentialDisplayEncodings?: Readonly<Record<string, CredentialDisplayEncoding>>;
  applicationValidator?: (context: ValidationApplicationContext) => Promise<void>;
  crossVariableValidators?: readonly ((context: Readonly<{
    appId: string;
    items: readonly ChangeValidateRequest['items'][number][];
  }>) => void)[];
  now?: () => Date;
}>;

export type PersistedChangeItem = Readonly<{
  appId: string;
  sourceId: string;
  catalogId: string;
  name: string;
  duplicateOrdinal: number;
  operation: 'set' | 'delete';
  requirement: 'required' | 'optional';
  value?: string;
  sourceFingerprint: string;
}>;

export type ValidatedChangeDraft = Readonly<{
  changeId: string;
  appId: string;
  catalogVersion: string;
  manifestVersion: string;
  changeDigest: string;
  expiresAt: string;
  sourceIds: readonly string[];
  actionIds: readonly string[];
  checkIds: readonly string[];
  items: readonly PersistedChangeItem[];
}>;

export type ValidationResult = Readonly<{
  changeId: string;
  state: 'READY';
  changeDigest: string;
  itemFingerprints: readonly {
    catalogId: string;
    sourceId: string;
    oldValueFingerprint: string;
    newValueFingerprint: string;
  }[];
  impactPlan: ChangeImpactPlan;
  ruleIds: readonly string[];
  warnings: readonly string[];
}>;

export type ValidationErrorCode =
  | 'VALIDATION_REQUEST_INVALID'
  | 'CATALOG_METADATA_MISMATCH'
  | 'UNKNOWN_VARIABLE'
  | 'OBSERVED_VARIABLE'
  | 'REQUIRED_DELETE'
  | 'SOURCE_NOT_FOUND'
  | 'DUPLICATE_DEFINITION'
  | 'CONFIG_SOURCE_CHANGED'
  | 'SOURCE_PARSE_FAILED'
  | 'VARIABLE_RULE_FAILED'
  | 'CROSS_VARIABLE_RULE_FAILED'
  | 'APPLICATION_VALIDATOR_FAILED'
  | 'PUBLIC_BUILD_NOT_ALLOWED'
  | 'VALIDATION_STORAGE_FAILED';

export class ValidationServiceError extends Error {
  readonly code: ValidationErrorCode;

  constructor(code: ValidationErrorCode) {
    super(code);
    this.name = 'ValidationServiceError';
    this.code = code;
  }
}

function fail(code: ValidationErrorCode): never {
  throw new ValidationServiceError(code);
}

function classifyRequestFailure(rawRequest: unknown): ValidationErrorCode {
  if (typeof rawRequest !== 'object' || rawRequest === null) return 'VALIDATION_REQUEST_INVALID';
  const items = (rawRequest as Record<string, unknown>).items;
  if (!Array.isArray(items)) return 'VALIDATION_REQUEST_INVALID';
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    if (candidate.operation === 'delete' && candidate.requirement === 'required') return 'REQUIRED_DELETE';
    if (candidate.mutability === 'observed' || candidate.requirement === 'unknown') return 'OBSERVED_VARIABLE';
  }
  return 'VALIDATION_REQUEST_INVALID';
}

function userId(name: string): number | undefined {
  try {
    for (const line of readFileSync('/etc/passwd', 'utf8').split(/\r?\n/u)) {
      const fields = line.split(':');
      if (fields[0] === name && fields[2] && /^[0-9]+$/u.test(fields[2])) return Number(fields[2]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function groupId(name: string): number | undefined {
  try {
    for (const line of readFileSync('/etc/group', 'utf8').split(/\r?\n/u)) {
      const fields = line.split(':');
      if (fields[0] === name && fields[2] && /^[0-9]+$/u.test(fields[2])) return Number(fields[2]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sourcePath(source: ManifestSource): { path: string; trustedRoot?: string } {
  if (source.locator.kind === 'file') return { path: source.locator.path };
  const resolved = resolveActiveReleaseLink({
    sourceId: source.id,
    currentPath: source.locator.currentPath,
    approvedTargetRoot: source.locator.approvedTargetRoot,
    fixedDescendant: source.locator.fixedDescendant
  });
  return { path: resolved.sourcePath, trustedRoot: resolved.releasePath };
}

function defaultReadSource(source: ManifestSource): ValidationSourceRead {
  const uid = userId(source.owner);
  const gid = groupId(source.group);
  if (uid === undefined || gid === undefined) fail('SOURCE_NOT_FOUND');
  const resolved = sourcePath(source);
  return readSafeSourceFile({
    sourceId: source.id,
    path: resolved.path,
    ...(resolved.trustedRoot ? { trustedRoot: resolved.trustedRoot } : {}),
    expected: { uid, gid, mode: source.mode, maximumBytes: source.maximumBytes }
  });
}

function adapterFor(source: ManifestSource) {
  switch (source.adapterId) {
    case 'node_env_file':
      return nodeEnvFileAdapter;
    case 'systemd_environment_file':
      return systemdEnvironmentFileAdapter;
    case 'dotenv':
      return dotenvFileAdapter;
    case 'pm2_ecosystem_static':
      return pm2EcosystemStaticAdapter;
    default:
      return null;
  }
}

function parseSource(
  source: ManifestSource,
  bytes: Buffer,
  credentialName: string | undefined,
  displayEncoding: CredentialDisplayEncoding
): ParsedSource {
  try {
    if (source.adapterId === 'systemd_credential_file') {
      if (!credentialName) fail('SOURCE_PARSE_FAILED');
      const parsed = parseSystemdCredentialFile(bytes, {
        name: credentialName,
        displayEncoding,
        maximumBytes: source.maximumBytes
      });
      if (!parsed.bytes.equals(bytes)) fail('SOURCE_PARSE_FAILED');
      return parsed;
    }
    const adapter = adapterFor(source);
    if (!adapter) fail('SOURCE_PARSE_FAILED');
    const parsed = adapter.parse(bytes, { maximumBytes: source.maximumBytes });
    if (!adapter.serialize(parsed).equals(bytes)) fail('SOURCE_PARSE_FAILED');
    return parsed;
  } catch (error) {
    if (error instanceof ValidationServiceError) throw error;
    fail('SOURCE_PARSE_FAILED');
  }
}

function catalogMatch(item: ChangeValidateRequest['items'][number], entry: CatalogEntry): boolean {
  return (
    item.appId === entry.appId &&
    item.sourceId === entry.sourceId &&
    item.catalogId === entry.id &&
    item.name === entry.name &&
    item.requirement === entry.requirement &&
    item.mutability === entry.mutability &&
    item.strategy === entry.applyStrategy
  );
}

function validateValue(entry: CatalogEntry, value: string, catalog: Catalog): string {
  if (Buffer.byteLength(value, 'utf8') > 65_536 || value.includes('\u0000')) {
    fail('VARIABLE_RULE_FAILED');
  }
  if (!entry.validatorId) return 'value.present';
  const validator = catalog.validators.find((candidate) => candidate.id === entry.validatorId);
  if (!validator) fail('VARIABLE_RULE_FAILED');
  try {
    switch (validator.type) {
      case 'url': {
        const parsed = new URL(value);
        if (!validator.allowedSchemes.includes(parsed.protocol.slice(0, -1))) {
          fail('VARIABLE_RULE_FAILED');
        }
        break;
      }
      case 'integer': {
        if (!/^-?[0-9]+$/u.test(value)) fail('VARIABLE_RULE_FAILED');
        const numeric = Number(value);
        if (!Number.isSafeInteger(numeric)) fail('VARIABLE_RULE_FAILED');
        if (validator.minimum !== undefined && numeric < validator.minimum) fail('VARIABLE_RULE_FAILED');
        if (validator.maximum !== undefined && numeric > validator.maximum) fail('VARIABLE_RULE_FAILED');
        break;
      }
      case 'enum':
        if (!validator.allowedValues.includes(value)) fail('VARIABLE_RULE_FAILED');
        break;
      case 'regex':
        if (!new RegExp(validator.pattern, validator.flags).test(value)) fail('VARIABLE_RULE_FAILED');
        break;
      case 'non_empty':
        if (value.trim().length === 0) fail('VARIABLE_RULE_FAILED');
        break;
      case 'json':
        JSON.parse(value);
        break;
    }
  } catch (error) {
    if (error instanceof ValidationServiceError) throw error;
    fail('VARIABLE_RULE_FAILED');
  }
  return validator.id;
}

function canonicalPatch(items: readonly PersistedChangeItem[]): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      items.map((item) => ({
        appId: item.appId,
        sourceId: item.sourceId,
        catalogId: item.catalogId,
        name: item.name,
        duplicateOrdinal: item.duplicateOrdinal,
        operation: item.operation,
        requirement: item.requirement,
        sourceFingerprint: item.sourceFingerprint,
        ...(item.value === undefined ? {} : { value: item.value })
      }))
    )}\n`,
    'utf8'
  );
}

function digest(key: FingerprintKey, items: readonly PersistedChangeItem[]): string {
  return hmacFingerprint(key, 'change_digest', canonicalPatch(items));
}

function actionAndCheckIds(
  sources: readonly ManifestSource[],
  ids: readonly string[]
): { actionIds: string[]; checkIds: string[] } {
  const actionIds = new Set<string>();
  const checkIds = new Set<string>();
  for (const source of sources) {
    for (const id of source.actionIds ?? []) actionIds.add(id);
    for (const id of source.checkIds ?? []) checkIds.add(id);
  }
  return {
    actionIds: [...actionIds].sort(),
    checkIds: [...checkIds].sort()
  };
}

function impactPlan(
  appId: string,
  entries: readonly CatalogEntry[],
  sources: readonly ManifestSource[],
  warnings: readonly string[]
): ChangeImpactPlan {
  const strategies = [...new Set(entries.map((entry) => entry.applyStrategy))].sort();
  const sourceIds = [...new Set(sources.map((source) => source.id))].sort();
  const { actionIds, checkIds } = actionAndCheckIds(sources, sourceIds);
  return {
    applicationId: appId,
    strategies,
    sourceIds,
    actionIds,
    checkIds,
    counts: {
      items: entries.length,
      sets: entries.filter((_, index) => index >= 0).length,
      deletes: 0,
      sources: sourceIds.length
    },
    warnings: [...warnings],
    expectedEffect: strategies[0] ?? 'no_runtime_action'
  };
}

export function createValidationService(options: ValidationServiceOptions) {
  const readSource = options.readSource ?? defaultReadSource;
  const now = options.now ?? (() => new Date());
  const encodings = options.credentialDisplayEncodings ?? {};

  async function validate(rawRequest: unknown): Promise<ValidationResult> {
    const parsedRequest = ChangeValidateRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) fail(classifyRequestFailure(rawRequest));
    const request = parsedRequest.data;
    if (
      request.catalogVersion !== options.catalog.catalogVersion ||
      request.manifestVersion !== options.manifest.manifestVersion ||
      options.manifest.catalogVersion !== options.catalog.catalogVersion
    ) {
      fail('CATALOG_METADATA_MISMATCH');
    }
    const sourceById = new Map(options.manifest.sources.map((source) => [source.id, source]));
    const catalogById = new Map(options.catalog.entries.map((entry) => [entry.id, entry]));
    const sourceReads = new Map<string, ValidationSourceRead>();
    const parsedSources = new Map<string, ParsedSource>();
    const touchedSources = new Map<string, ManifestSource>();
    const persistedItems: PersistedChangeItem[] = [];
    const itemFingerprints: Array<{
      catalogId: string;
      sourceId: string;
      oldValueFingerprint: string;
      newValueFingerprint: string;
    }> = [];
    const ruleIds = new Set<string>();
    const warnings: string[] = [];
    let setCount = 0;
    let deleteCount = 0;

    for (const rawItem of request.items) {
      const itemResult = ChangeItemSchema.safeParse(rawItem);
      if (!itemResult.success) fail('VALIDATION_REQUEST_INVALID');
      const item = itemResult.data;
      const source = sourceById.get(item.sourceId);
      const entry = catalogById.get(item.catalogId);
      if (!source || !entry || !catalogMatch(item, entry)) {
        if (!entry) fail('UNKNOWN_VARIABLE');
        fail('CATALOG_METADATA_MISMATCH');
      }
      if (source.appId !== request.appId || entry.appId !== request.appId) {
        fail('CATALOG_METADATA_MISMATCH');
      }
      if (source.mutability !== 'catalog_controlled' || entry.mutability === 'observed') {
        fail('OBSERVED_VARIABLE');
      }
      if (item.operation === 'delete' && entry.requirement !== 'optional') fail('REQUIRED_DELETE');
      let existing = sourceReads.get(source.id);
      if (!existing) {
        try {
          existing = await readSource(source);
        } catch (error) {
          if (error instanceof ValidationServiceError) throw error;
          const code = error instanceof Error && 'code' in error ? error.code : undefined;
          if (code === 'SOURCE_METADATA_DRIFT') fail('CONFIG_SOURCE_CHANGED');
          fail('SOURCE_NOT_FOUND');
        }
      }
      sourceReads.set(source.id, existing);
      const sourceDigest = fingerprintSource(options.fingerprintKey, source.id, existing.bytes);
      if (sourceDigest !== item.sourceFingerprint) fail('CONFIG_SOURCE_CHANGED');
      const candidateName = entry.name;
      const parsed =
        parsedSources.get(source.id) ??
        parseSource(source, existing.bytes, candidateName, encodings[source.id] ?? 'text');
      parsedSources.set(source.id, parsed);
      const definitions = parsed.definitions.filter((definition) => definition.name === item.name);
      if (definitions.length !== 1) {
        if (definitions.length > 1) fail('DUPLICATE_DEFINITION');
        fail('SOURCE_NOT_FOUND');
      }
      const definition = definitions[0];
      if (!definition || definition.duplicateOrdinal !== 0) fail('DUPLICATE_DEFINITION');
      if (item.operation === 'set') {
        ruleIds.add(validateValue(entry, item.value ?? '', options.catalog));
        setCount += 1;
      } else {
        deleteCount += 1;
        const lower = options.manifest.sources.find(
          (candidate) => candidate.id !== source.id && candidate.appId === source.appId && candidate.precedenceRank < source.precedenceRank
        );
        if (lower) warnings.push('DELETE_EXPOSES_LOWER_PRECEDENCE');
      }
      touchedSources.set(source.id, source);
      const oldValueFingerprint = fingerprintValue(
        options.fingerprintKey,
        entry.id,
        definition.valueBytes
      );
      const newValueFingerprint = fingerprintValue(
        options.fingerprintKey,
        entry.id,
        Buffer.from(item.operation === 'delete' ? '' : item.value ?? '', 'utf8')
      );
      itemFingerprints.push({
        catalogId: entry.id,
        sourceId: source.id,
        oldValueFingerprint,
        newValueFingerprint
      });
      persistedItems.push({
        appId: item.appId,
        sourceId: item.sourceId,
        catalogId: item.catalogId,
        name: item.name,
        duplicateOrdinal: 0,
        operation: item.operation,
        requirement: entry.requirement,
        ...(item.value === undefined ? {} : { value: item.value }),
        sourceFingerprint: item.sourceFingerprint
      });
    }

    const sourceList = [...touchedSources.values()];
    for (const validator of options.crossVariableValidators ?? []) {
      try {
        validator({ appId: request.appId, items: request.items });
      } catch {
        fail('CROSS_VARIABLE_RULE_FAILED');
      }
    }
    const proposedSourceBytes: Record<string, Buffer> = {};
    for (const source of sourceList) {
      const parsed = parsedSources.get(source.id);
      const operations: SourceWriteOperation[] = persistedItems
        .filter((item) => item.sourceId === source.id)
        .map((item) => ({
          name: item.name,
          duplicateOrdinal: item.duplicateOrdinal,
          operation: item.operation,
          requirement: item.requirement,
          ...(source.adapterId === 'systemd_credential_file'
            ? { valueEncoding: encodings[source.id] ?? 'text' }
            : {}),
          ...(item.value === undefined ? {} : { value: item.value })
        }));
      if (!parsed) fail('SOURCE_PARSE_FAILED');
      try {
        proposedSourceBytes[source.id] = serializeUpdatedSource(parsed, operations);
      } catch {
        fail('SOURCE_PARSE_FAILED');
      }
    }
    if (options.applicationValidator) {
      try {
        await options.applicationValidator({
          appId: request.appId,
          changeId: request.changeId,
          sourceIds: sourceList.map((source) => source.id),
          proposedSourceBytes
        });
      } catch {
        fail('APPLICATION_VALIDATOR_FAILED');
      }
    }
    const plan = impactPlan(request.appId, request.items.map((item) => catalogById.get(item.catalogId) as CatalogEntry), sourceList, warnings);
    plan.counts.sets = setCount;
    plan.counts.deletes = deleteCount;
    if (plan.strategies.includes('build_redeploy')) {
      for (const item of request.items) {
        const entry = catalogById.get(item.catalogId);
        if (!entry || entry.sensitivity !== 'public' || !entry.buildAllowed) fail('PUBLIC_BUILD_NOT_ALLOWED');
      }
    }
    const changeDigest = digest(options.fingerprintKey, persistedItems);
    const expiresAt = new Date(now().getTime() + 24 * 60 * 60 * 1_000).toISOString();
    try {
      await options.draftStore.replaceDraft({
        changeId: request.changeId,
        appId: request.appId,
        catalogVersion: request.catalogVersion,
        manifestVersion: request.manifestVersion,
        value: {
          changeId: request.changeId,
          appId: request.appId,
          catalogVersion: request.catalogVersion,
          manifestVersion: request.manifestVersion,
          changeDigest,
          expiresAt,
          sourceIds: plan.sourceIds,
          actionIds: plan.actionIds,
          checkIds: plan.checkIds,
          items: persistedItems
        }
      });
    } catch {
      fail('VALIDATION_STORAGE_FAILED');
    }
    return {
      changeId: request.changeId,
      state: 'READY',
      changeDigest,
      itemFingerprints,
      impactPlan: plan,
      ruleIds: [...ruleIds].sort(),
      warnings: [...new Set(warnings)].sort()
    };
  }

  return { validate };
}
