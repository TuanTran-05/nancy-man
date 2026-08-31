import { readFileSync } from 'node:fs';

import {
  AgentManifestSchema,
  InventoryReadRequestSchema,
  type Catalog,
  type CatalogEntry,
  type AgentManifest,
  type InventoryDefinition,
  type InventoryReadRequest,
  type InventoryReadResponse,
  type ManifestSource
} from '../../../../packages/config-contracts/src/index.js';
import { dotenvFileAdapter } from '../adapters/dotenvFile.js';
import { nodeEnvFileAdapter } from '../adapters/nodeEnvFile.js';
import { pm2EcosystemStaticAdapter } from '../adapters/pm2EcosystemStatic.js';
import { systemdEnvironmentFileAdapter } from '../adapters/systemdEnvironmentFile.js';
import { systemdCredentialFileAdapter } from '../adapters/systemdCredentialFile.js';
import {
  parseSystemdCredentialFile,
  type CredentialDisplayEncoding
} from '../adapters/systemdCredentialFile.js';
import {
  readSafeSourceFile,
  resolveActiveReleaseLink,
  type SafeSourceMetadata
} from '../security/safeSourceFile.js';
import type { FingerprintKey } from './fingerprint.js';
import { fingerprintSource, fingerprintValue } from './fingerprint.js';

export type InventorySourceRead = Readonly<{
  bytes: Buffer;
  metadata: SafeSourceMetadata;
}>;

export type InventorySourceReader = (
  source: ManifestSource
) => InventorySourceRead | Promise<InventorySourceRead>;

export type InventoryServiceOptions = Readonly<{
  catalog: Catalog;
  manifest: AgentManifest;
  fingerprintKey: FingerprintKey;
  readSource?: InventorySourceReader;
  now?: () => Date;
  credentialNames?: Readonly<Record<string, string>>;
  credentialDisplayEncodings?: Readonly<Record<string, CredentialDisplayEncoding>>;
}>;

export type InventoryErrorCode =
  | 'INVENTORY_REQUEST_INVALID'
  | 'INVENTORY_SOURCE_READ_FAILED'
  | 'INVENTORY_SOURCE_PARSE_FAILED'
  | 'INVENTORY_SOURCE_METADATA_INVALID';

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;

  constructor(code: InventoryErrorCode) {
    super(code);
    this.name = 'InventoryError';
    this.code = code;
  }
}

export type InventoryService = Readonly<{
  read: (request: InventoryReadRequest) => Promise<InventoryReadResponse>;
}>;

type InternalDefinition = Readonly<{
  definitionId: string;
  name: string;
  sourceId: string;
  sourceOrder: number;
  duplicateOrdinal: number;
  precedenceRank: number;
  consumerIds: readonly string[];
  item: Omit<InventoryDefinition, 'relatedDefinitionIds' | 'precedence'>;
}>;

function userId(name: string): number | undefined {
  try {
    const lines = readFileSync('/etc/passwd', 'utf8').split(/\r?\n/u);
    for (const line of lines) {
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
    const lines = readFileSync('/etc/group', 'utf8').split(/\r?\n/u);
    for (const line of lines) {
      const fields = line.split(':');
      if (fields[0] === name && fields[2] && /^[0-9]+$/u.test(fields[2])) return Number(fields[2]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function declaredPath(source: ManifestSource): { path: string; trustedRoot?: string } {
  if (source.locator.kind === 'file') return { path: source.locator.path };
  const resolution = resolveActiveReleaseLink({
    sourceId: source.id,
    currentPath: source.locator.currentPath,
    approvedTargetRoot: source.locator.approvedTargetRoot,
    fixedDescendant: source.locator.fixedDescendant
  });
  return { path: resolution.sourcePath, trustedRoot: resolution.releasePath };
}

function defaultReadSource(source: ManifestSource): InventorySourceRead {
  const ownerUid = userId(source.owner);
  const groupGid = groupId(source.group);
  if (ownerUid === undefined || groupGid === undefined) {
    throw new InventoryError('INVENTORY_SOURCE_METADATA_INVALID');
  }
  const resolved = declaredPath(source);
  return readSafeSourceFile({
    sourceId: source.id,
    path: resolved.path,
    ...(resolved.trustedRoot ? { trustedRoot: resolved.trustedRoot } : {}),
    expected: {
      uid: ownerUid,
      gid: groupGid,
      mode: source.mode,
      maximumBytes: source.maximumBytes
    }
  });
}

function sourceAdapter(source: ManifestSource) {
  switch (source.adapterId) {
    case 'node_env_file':
      return nodeEnvFileAdapter;
    case 'systemd_environment_file':
      return systemdEnvironmentFileAdapter;
    case 'dotenv':
      return dotenvFileAdapter;
    case 'pm2_ecosystem_static':
      return pm2EcosystemStaticAdapter;
    case 'systemd_credential_file':
      return systemdCredentialFileAdapter;
    default:
      throw new InventoryError('INVENTORY_SOURCE_PARSE_FAILED');
  }
}

function credentialName(
  source: ManifestSource,
  configured: Readonly<Record<string, string>>
): string {
  const configuredName = configured[source.id];
  if (configuredName) return configuredName;
  const lastPart = source.id
    .split('.')
    .at(-1)
    ?.replace(/[^A-Za-z0-9_]/gu, '_')
    .toUpperCase();
  if (!lastPart || !/^[A-Z][A-Z0-9_]*$/u.test(lastPart)) {
    throw new InventoryError('INVENTORY_SOURCE_PARSE_FAILED');
  }
  return lastPart;
}

function parseSource(
  source: ManifestSource,
  bytes: Buffer,
  credentialNames: Readonly<Record<string, string>>,
  credentialEncodings: Readonly<Record<string, CredentialDisplayEncoding>>
) {
  try {
    if (source.adapterId === 'systemd_credential_file') {
      return parseSystemdCredentialFile(bytes, {
        name: credentialName(source, credentialNames),
        displayEncoding: credentialEncodings[source.id] ?? 'base64',
        maximumBytes: source.maximumBytes
      });
    }
    return sourceAdapter(source).parse(bytes, { maximumBytes: source.maximumBytes });
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError('INVENTORY_SOURCE_PARSE_FAILED');
  }
}

function definitionId(
  entry: CatalogEntry | undefined,
  source: ManifestSource,
  name: string,
  duplicateOrdinal: number
): string {
  const base = entry?.id ?? `${source.appId}.${source.id}.${name.toLowerCase()}`;
  return duplicateOrdinal === 0 ? base : `${base}.duplicate.${duplicateOrdinal}`;
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return true;
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function isHigherPrecedence(candidate: InternalDefinition, current: InternalDefinition): boolean {
  if (candidate.precedenceRank !== current.precedenceRank) {
    return candidate.precedenceRank > current.precedenceRank;
  }
  if (candidate.sourceId === current.sourceId) {
    return candidate.duplicateOrdinal > current.duplicateOrdinal;
  }
  return candidate.sourceOrder > current.sourceOrder;
}

function sourceMtime(metadata: SafeSourceMetadata): string | null {
  if (!Number.isFinite(metadata.mtimeMs) || metadata.mtimeMs < 0) return null;
  try {
    return new Date(metadata.mtimeMs).toISOString();
  } catch {
    return null;
  }
}

export function createInventoryService(options: InventoryServiceOptions): InventoryService {
  const manifest = AgentManifestSchema.parse(options.manifest);
  const appNames = new Map(manifest.apps.map((app) => [app.id, app.displayName]));
  const entries = new Map(
    options.catalog.entries.map((entry) => [`${entry.sourceId}\u0000${entry.name}`, entry])
  );
  const readSource = options.readSource ?? defaultReadSource;
  const now = options.now ?? (() => new Date());
  const credentialNames = options.credentialNames ?? {};
  const credentialEncodings = options.credentialDisplayEncodings ?? {};

  async function read(request: InventoryReadRequest): Promise<InventoryReadResponse> {
    let validated: InventoryReadRequest;
    try {
      validated = InventoryReadRequestSchema.parse(request);
    } catch {
      throw new InventoryError('INVENTORY_REQUEST_INVALID');
    }

    const internal: InternalDefinition[] = [];
    for (const [sourceOrder, source] of manifest.sources.entries()) {
      let sourceRead: InventorySourceRead;
      try {
        sourceRead = await readSource(source);
      } catch (error) {
        if (error instanceof InventoryError) throw error;
        throw new InventoryError('INVENTORY_SOURCE_READ_FAILED');
      }
      const parsed = parseSource(source, sourceRead.bytes, credentialNames, credentialEncodings);
      const sourceFingerprint = fingerprintSource(
        options.fingerprintKey,
        source.id,
        sourceRead.bytes
      );
      const appName = appNames.get(source.appId);
      if (!appName) throw new InventoryError('INVENTORY_SOURCE_METADATA_INVALID');

      for (const definition of parsed.definitions) {
        const catalogEntry = entries.get(`${source.id}\u0000${definition.name}`);
        const consumers = catalogEntry?.consumerIds ?? source.consumerIds ?? [];
        const id = definitionId(catalogEntry, source, definition.name, definition.duplicateOrdinal);
        const common = {
          name: definition.name,
          value: definition.value,
          appId: source.appId,
          appName,
          functionIds: [catalogEntry?.category ?? 'unknown'],
          sourceId: source.id,
          sourcePathLabel: source.pathLabel,
          sourceAdapter: source.adapterId,
          consumerIds: [...consumers],
          category: catalogEntry?.category ?? 'runtime_networking',
          description:
            catalogEntry?.description ?? 'Observed active definition not present in the catalog.',
          sensitivity: catalogEntry?.sensitivity ?? 'internal',
          requirement: catalogEntry?.requirement ?? 'unknown',
          mutability: catalogEntry?.mutability ?? 'observed',
          applyStrategy: catalogEntry?.applyStrategy ?? 'no_runtime_action',
          sourceFingerprint,
          valueFingerprint: fingerprintValue(
            options.fingerprintKey,
            catalogEntry?.id ?? id,
            definition.valueBytes
          ),
          sourceMtime: sourceMtime(sourceRead.metadata)
        } satisfies Omit<
          InventoryDefinition,
          'catalogId' | 'relatedDefinitionIds' | 'precedence'
        > & {
          catalogId?: string;
        };
        const item = catalogEntry ? { ...common, catalogId: catalogEntry.id } : common;
        internal.push({
          definitionId: id,
          name: definition.name,
          sourceId: source.id,
          sourceOrder,
          duplicateOrdinal: definition.duplicateOrdinal,
          precedenceRank: source.precedenceRank,
          consumerIds: consumers,
          item
        });
      }
    }

    const grouped = new Map<string, InternalDefinition[]>();
    for (const item of internal) {
      const group = grouped.get(item.name) ?? [];
      group.push(item);
      grouped.set(item.name, group);
    }
    const items: InventoryDefinition[] = [];
    for (const item of internal) {
      const group = grouped.get(item.name) ?? [];
      const relatedDefinitionIds = group
        .filter((candidate) => candidate.definitionId !== item.definitionId)
        .map((candidate) => candidate.definitionId);
      const effective = !group.some(
        (candidate) =>
          candidate.definitionId !== item.definitionId &&
          intersects(candidate.consumerIds, item.consumerIds) &&
          isHigherPrecedence(candidate, item)
      );
      const precedence = {
        precedenceId:
          options.catalog.entries.find(
            (entry) => entry.sourceId === item.sourceId && entry.name === item.name
          )?.precedenceId ?? item.sourceId,
        rank: item.precedenceRank,
        effective
      };
      items.push({ ...item.item, relatedDefinitionIds, precedence });
    }

    const filtered = items.filter((item) => {
      if (validated.appIds && !validated.appIds.includes(item.appId)) return false;
      if (validated.sourceIds && !validated.sourceIds.includes(item.sourceId)) return false;
      if (validated.categoryIds && !validated.categoryIds.includes(item.category)) return false;
      if (validated.variableNames && !validated.variableNames.includes(item.name)) return false;
      return true;
    });
    const limit = validated.limit ?? filtered.length;
    return {
      catalogVersion: options.catalog.catalogVersion,
      manifestVersion: manifest.manifestVersion,
      generatedAt: now().toISOString(),
      items: filtered.slice(0, limit)
    };
  }

  return { read };
}

export class InventoryServiceClass implements InventoryService {
  private readonly service: InventoryService;

  constructor(options: InventoryServiceOptions) {
    this.service = createInventoryService(options);
  }

  read(request: InventoryReadRequest): Promise<InventoryReadResponse> {
    return this.service.read(request);
  }
}
