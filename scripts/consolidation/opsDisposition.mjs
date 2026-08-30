import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const GENERATED_ROOTS = [
  'ops-console/dist',
  'ops-console/node_modules',
  'ops-console/test-results'
];
const INPUT_EVIDENCE_PATH = 'docs/architecture/baselines/2026-08-29-ops-consolidation-inputs.json';

const sha40 = z.string().regex(/^[0-9a-f]{40}$/);
const sha64 = z.string().regex(/^[0-9a-f]{64}$/);
const hasControlCharacter = (value) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !hasControlCharacter(value) &&
      value.normalize('NFC') === value &&
      value
        .split('/')
        .every((component) => component.length > 0 && component !== '.' && component !== '..')
  );
const disposition = z.enum(['integrate', 'superseded', 'generated', 'pending']);
const evidenceIdentity = z.strictObject({
  path: relativePath,
  gitBlobSha: sha40,
  contentSha256: sha64
});
const entry = z.strictObject({
  sourceAlias: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  sourceKind: z.enum(['git-blob', 'generated-root']),
  sourcePath: relativePath,
  sourceGitBlobSha: sha40.nullable(),
  sourceSha256: sha64,
  targetRepository: z.literal('edutrack-ops'),
  targetPath: relativePath.nullable(),
  targetGitBlobSha: sha40.nullable(),
  targetContentSha256: sha64.nullable(),
  disposition,
  replacementSha: sha40.nullable(),
  evidence: z.array(relativePath).min(1),
  evidenceIdentities: z.array(evidenceIdentity),
  capturedAt: z.string().datetime()
});
const ledger = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum(['construction', 'final']),
  capturedAt: z.string().datetime(),
  entries: z.array(entry).min(1)
});
const trackedFile = z.strictObject({
  sourcePath: relativePath,
  gitBlobSha: sha40,
  contentSha256: sha64
});
const generatedRoot = z.strictObject({
  sourcePath: z.enum(GENERATED_ROOTS),
  treeSha256: sha64,
  fileCount: z.number().int().nonnegative(),
  directoryCount: z.number().int().nonnegative(),
  symlinkCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative()
});
const sourceRecord = z.strictObject({
  repository: z.string().min(1),
  sourceAlias: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  gitSha: sha40,
  treeSha: sha40
});
const runtimeService = z.strictObject({
  name: z.string().regex(/^edutrack-ops-[a-z0-9@.-]+\.service$/),
  activeState: z.enum(['active', 'inactive', 'failed']),
  subState: z.string().regex(/^[a-z][a-z-]*$/),
  fragmentScope: z.literal('system')
});
const inputsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  canonical: sourceRecord,
  embedded: sourceRecord,
  runtimeIdentity: z.strictObject({
    currentReleaseName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    services: z.array(runtimeService).min(1)
  }),
  trackedPrefix: z.literal('ops-console'),
  trackedFileCount: z.number().int().positive(),
  trackedInventorySha256: sha64,
  trackedFiles: z.array(trackedFile).min(1),
  generatedRootCount: z.literal(3),
  generatedInventorySha256: sha64,
  generatedRoots: z.array(generatedRoot).length(3),
  frozenUniverseSha256: sha64
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

export function deterministicJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function git(repositoryRoot, args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repositoryRoot,
      encoding: options.encoding ?? 'utf8',
      input: options.input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore']
    });
  } catch {
    fail(options.errorCode ?? 'OPS_GIT_INPUT_INVALID');
  }
}

function requireFullCommit(repositoryRoot, commitSha) {
  if (!sha40.safeParse(commitSha).success) fail('OPS_GIT_COMMIT_NOT_FULL_SHA');
  git(repositoryRoot, ['cat-file', '-e', `${commitSha}^{commit}`]);
  return git(repositoryRoot, ['rev-parse', `${commitSha}^{tree}`]).trim();
}

function parseLsTree(bytes) {
  const records = bytes.split('\0').filter(Boolean);
  return records.map((record) => {
    const match = /^(\d{6}) blob ([0-9a-f]{40})\t(.+)$/.exec(record);
    if (!match) fail('OPS_GIT_TREE_ENTRY_INVALID');
    if (match[1] === '120000') fail('OPS_GIT_TREE_SYMLINK');
    return { sourcePath: match[3], gitBlobSha: match[2] };
  });
}

function batchBlobSha256(repositoryRoot, blobShas) {
  const unique = [...new Set(blobShas)];
  const output = git(repositoryRoot, ['cat-file', '--batch', '-Z'], {
    encoding: 'buffer',
    input: Buffer.from(`${unique.join('\0')}\0`)
  });
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output);
  const result = new Map();
  let offset = 0;
  for (const blobSha of unique) {
    const headerEnd = bytes.indexOf(0, offset);
    if (headerEnd < 0) fail('OPS_GIT_BLOB_INVALID');
    const header = bytes.subarray(offset, headerEnd).toString('utf8');
    const match = /^([0-9a-f]{40}) blob (\d+)$/.exec(header);
    if (!match || match[1] !== blobSha) fail('OPS_GIT_BLOB_INVALID');
    const size = Number(match[2]);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (!Number.isSafeInteger(size) || bytes[contentEnd] !== 0) fail('OPS_GIT_BLOB_INVALID');
    result.set(blobSha, hash(bytes.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  if (offset !== bytes.length) fail('OPS_GIT_BLOB_INVALID');
  return result;
}

function gitSucceeds(repositoryRoot, args) {
  try {
    execFileSync('git', args, {
      cwd: repositoryRoot,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function resolveCommit(repositoryRoot, revision, errorCode) {
  const resolved = git(repositoryRoot, ['rev-parse', '--verify', `${revision}^{commit}`], {
    errorCode
  }).trim();
  if (!sha40.safeParse(resolved).success) fail(errorCode);
  return resolved;
}

function loadGitTree(repositoryRoot, commitSha) {
  const output = git(repositoryRoot, ['ls-tree', '-r', '-t', '-z', '--full-tree', commitSha]);
  const result = new Map();
  for (const record of output.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    if (separator < 0) fail('OPS_DISPOSITION_GIT_TREE_INVALID');
    const metadata = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})$/.exec(record.slice(0, separator));
    if (!metadata) fail('OPS_DISPOSITION_GIT_TREE_INVALID');
    const filePath = record.slice(separator + 1);
    if (result.has(filePath)) fail('OPS_DISPOSITION_GIT_TREE_INVALID');
    result.set(filePath, {
      mode: metadata[1],
      type: metadata[2],
      objectSha: metadata[3]
    });
  }
  return result;
}

function isRegularGitBlob(item) {
  return item?.type === 'blob' && ['100644', '100755'].includes(item.mode);
}

function mappingEntries(parsedLedger) {
  return parsedLedger.entries.filter((item) =>
    ['integrate', 'superseded'].includes(item.disposition)
  );
}

function validateFinalMappingAliases(parsedLedger) {
  const aliases = new Map();
  const groups = new Map();
  for (const item of mappingEntries(parsedLedger)) {
    const alias = item.targetPath.normalize('NFC').toLowerCase();
    const previousPath = aliases.get(alias);
    if (previousPath && previousPath !== item.targetPath) {
      fail('OPS_DISPOSITION_TARGET_ALIAS_COLLISION');
    }
    aliases.set(alias, item.targetPath);
    const group = groups.get(item.targetPath) ?? [];
    group.push(item);
    groups.set(item.targetPath, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const fingerprints = new Set(
      group.map((item) =>
        JSON.stringify({
          replacementSha: item.replacementSha,
          targetGitBlobSha: item.targetGitBlobSha,
          targetContentSha256: item.targetContentSha256,
          evidence: item.evidence,
          evidenceIdentities: item.evidenceIdentities
        })
      )
    );
    if (fingerprints.size !== 1) fail('OPS_DISPOSITION_MANY_TO_ONE_CONFLICT');
  }
}

function validateFinalMappingGit(parsedLedger, inputs, { repositoryRoot, headSha = 'HEAD' } = {}) {
  if (!repositoryRoot || !path.isAbsolute(repositoryRoot)) {
    fail('OPS_DISPOSITION_REPOSITORY_INVALID');
  }
  const resolvedHead = resolveCommit(
    repositoryRoot,
    headSha,
    'OPS_DISPOSITION_CANONICAL_HEAD_INVALID'
  );
  if (
    !gitSucceeds(repositoryRoot, [
      'merge-base',
      '--is-ancestor',
      inputs.canonical.gitSha,
      resolvedHead
    ])
  ) {
    fail('OPS_DISPOSITION_CANONICAL_LINEAGE_INVALID');
  }
  validateFinalMappingAliases(parsedLedger);
  const trees = new Map();
  const mappings = mappingEntries(parsedLedger);
  for (const item of mappings) {
    const replacementType = git(repositoryRoot, ['cat-file', '-t', item.replacementSha], {
      errorCode: 'OPS_DISPOSITION_REPLACEMENT_ABSENT'
    }).trim();
    if (replacementType !== 'commit') fail('OPS_DISPOSITION_REPLACEMENT_NOT_COMMIT');
    if (
      !gitSucceeds(repositoryRoot, [
        'merge-base',
        '--is-ancestor',
        item.replacementSha,
        resolvedHead
      ])
    ) {
      fail('OPS_DISPOSITION_REPLACEMENT_UNREACHABLE');
    }
    if (!trees.has(item.replacementSha)) {
      trees.set(item.replacementSha, loadGitTree(repositoryRoot, item.replacementSha));
    }
  }
  const blobShas = new Set();
  const resolvedMappings = [];
  for (const item of mappings) {
    const tree = trees.get(item.replacementSha);
    const target = tree.get(item.targetPath);
    if (!target) fail('OPS_DISPOSITION_TARGET_ABSENT');
    if (!isRegularGitBlob(target)) fail('OPS_DISPOSITION_TARGET_TYPE_INVALID');
    blobShas.add(target.objectSha);
    const evidence = item.evidence.map((evidencePath) => {
      const evidenceObject = tree.get(evidencePath);
      if (!evidenceObject) fail('OPS_DISPOSITION_EVIDENCE_ABSENT');
      if (!isRegularGitBlob(evidenceObject)) fail('OPS_DISPOSITION_EVIDENCE_TYPE_INVALID');
      blobShas.add(evidenceObject.objectSha);
      return evidenceObject;
    });
    resolvedMappings.push({ item, target, evidence });
  }
  const contentDigests = batchBlobSha256(repositoryRoot, [...blobShas]);
  for (const { item, target, evidence } of resolvedMappings) {
    if (item.targetGitBlobSha !== target.objectSha) {
      fail('OPS_DISPOSITION_TARGET_IDENTITY_MISMATCH');
    }
    if (item.targetContentSha256 !== contentDigests.get(target.objectSha)) {
      fail('OPS_DISPOSITION_TARGET_DIGEST_MISMATCH');
    }
    for (let index = 0; index < evidence.length; index += 1) {
      const expected = item.evidenceIdentities[index];
      const actual = evidence[index];
      if (expected.gitBlobSha !== actual.objectSha) {
        fail('OPS_DISPOSITION_EVIDENCE_IDENTITY_MISMATCH');
      }
      if (expected.contentSha256 !== contentDigests.get(actual.objectSha)) {
        fail('OPS_DISPOSITION_EVIDENCE_DIGEST_MISMATCH');
      }
    }
  }
  return parsedLedger;
}

export function captureTrackedGitInventory({ repositoryRoot, commitSha, prefix = 'ops-console' }) {
  if (!path.isAbsolute(repositoryRoot)) fail('OPS_GIT_REPOSITORY_INVALID');
  requireFullCommit(repositoryRoot, commitSha);
  if (prefix !== 'ops-console') fail('OPS_GIT_PREFIX_INVALID');
  const parsed = parseLsTree(
    git(repositoryRoot, ['ls-tree', '-r', '-z', '--full-tree', commitSha, '--', prefix])
  ).sort((left, right) => compareText(left.sourcePath, right.sourcePath));
  if (parsed.length === 0) fail('OPS_GIT_INVENTORY_EMPTY');
  const digests = batchBlobSha256(
    repositoryRoot,
    parsed.map((item) => item.gitBlobSha)
  );
  const entries = parsed.map((item) => ({
    ...item,
    contentSha256: digests.get(item.gitBlobSha)
  }));
  return {
    count: entries.length,
    inventorySha256: hash(JSON.stringify(entries)),
    entries
  };
}

function generatedPathForbidden(relativeName) {
  const parts = relativeName.toLowerCase().split('/');
  const basename = parts.at(-1);
  return (
    basename.startsWith('.env') ||
    /\.(?:sqlite(?:3)?|db)(?:-(?:wal|shm|journal))?$/.test(basename) ||
    parts.some((part) =>
      ['secret', 'secrets', 'database', 'backup', 'backups', 'log', 'logs', 'evidence'].includes(
        part
      )
    )
  );
}

function walkGeneratedRoot(rootPath) {
  const records = [];
  let fileCount = 0;
  let directoryCount = 0;
  let symlinkCount = 0;
  let totalBytes = 0;

  function walk(directory, relativeDirectory) {
    const names = readdirSync(directory).sort(compareText);
    for (const name of names) {
      const relativeName = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (generatedPathForbidden(relativeName)) fail('OPS_GENERATED_ROOT_FORBIDDEN_FILE');
      const absoluteName = path.join(directory, name);
      const stat = lstatSync(absoluteName);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(absoluteName);
        const resolvedTarget = path.resolve(path.dirname(absoluteName), target);
        if (
          path.isAbsolute(target) ||
          target.includes('\\') ||
          (resolvedTarget !== rootPath && !resolvedTarget.startsWith(`${rootPath}${path.sep}`))
        ) {
          fail('OPS_GENERATED_ROOT_SYMLINK');
        }
        symlinkCount += 1;
        records.push(`symlink\0${relativeName}\0${target}`);
      } else if (stat.isDirectory()) {
        directoryCount += 1;
        records.push(`directory\0${relativeName}`);
        walk(absoluteName, relativeName);
      } else if (stat.isFile()) {
        if (stat.nlink !== 1) fail('OPS_GENERATED_ROOT_HARDLINK');
        const bytes = readFileSync(absoluteName);
        fileCount += 1;
        totalBytes += bytes.length;
        records.push(`file\0${relativeName}\0${bytes.length}\0${hash(bytes)}`);
      } else {
        fail('OPS_GENERATED_ROOT_FILE_TYPE_INVALID');
      }
    }
  }

  walk(rootPath, '');
  return { records, fileCount, directoryCount, symlinkCount, totalBytes };
}

export function captureGeneratedRoot(rootPath, sourcePath) {
  if (!GENERATED_ROOTS.includes(sourcePath)) fail('OPS_GENERATED_ROOT_PATH_FORBIDDEN');
  if (!path.isAbsolute(rootPath)) fail('OPS_GENERATED_ROOT_PATH_INVALID');
  let rootStat;
  try {
    rootStat = lstatSync(rootPath);
  } catch {
    fail('OPS_GENERATED_ROOT_MISSING');
  }
  if (rootStat.isSymbolicLink()) fail('OPS_GENERATED_ROOT_SYMLINK');
  if (!rootStat.isDirectory()) fail('OPS_GENERATED_ROOT_NOT_DIRECTORY');
  const captured = walkGeneratedRoot(rootPath);
  return {
    sourcePath,
    treeSha256: hash(captured.records.join('\n')),
    fileCount: captured.fileCount,
    directoryCount: captured.directoryCount,
    symlinkCount: captured.symlinkCount,
    totalBytes: captured.totalBytes
  };
}

function frozenUniverse(inputs) {
  return [
    ...inputs.trackedFiles.map((item) => ({
      sourceAlias: inputs.embedded.sourceAlias,
      sourceKind: 'git-blob',
      sourcePath: item.sourcePath,
      sourceGitBlobSha: item.gitBlobSha,
      sourceSha256: item.contentSha256
    })),
    ...inputs.generatedRoots.map((item) => ({
      sourceAlias: inputs.embedded.sourceAlias,
      sourceKind: 'generated-root',
      sourcePath: item.sourcePath,
      sourceGitBlobSha: null,
      sourceSha256: item.treeSha256
    }))
  ].sort((left, right) => compareText(left.sourcePath, right.sourcePath));
}

export function assertSafeEvidenceJson(value) {
  const text = deterministicJson(value);
  if (/(?:^|["\s])\/(?:home|srv|etc|var)\//m.test(text)) fail('OPS_EVIDENCE_ABSOLUTE_PATH');
  if (
    /(?:PASSWORD|TOKEN|SECRET|API_KEY|DATABASE_URL)\s*=/i.test(text) ||
    /"(?:password|token|secret|credentials|databaseUrl|payload|rows|document)"\s*:/i.test(text)
  ) {
    fail('OPS_EVIDENCE_SECRET');
  }
  return text;
}

export function validateOpsInputs(value) {
  const parsed = inputsSchema.safeParse(value);
  if (!parsed.success) fail('OPS_INPUTS_SCHEMA_INVALID');
  const inputs = parsed.data;
  if (inputs.canonical.repository !== 'edutrack-ops') fail('OPS_INPUTS_CANONICAL_INVALID');
  if (inputs.embedded.repository !== 'embedded-ops-console') fail('OPS_INPUTS_EMBEDDED_INVALID');
  const trackedPaths = inputs.trackedFiles.map((item) => item.sourcePath);
  if (
    new Set(trackedPaths).size !== trackedPaths.length ||
    trackedPaths.some((item, index) => index > 0 && compareText(trackedPaths[index - 1], item) >= 0)
  ) {
    fail('OPS_INPUTS_TRACKED_ORDER_INVALID');
  }
  const generatedPaths = inputs.generatedRoots.map((item) => item.sourcePath);
  if (trackedPaths.some((item) => generatedPaths.includes(item))) {
    fail('OPS_INPUTS_SOURCE_COLLISION');
  }
  const pathAliases = [...trackedPaths, ...generatedPaths].map((item) => item.toLowerCase());
  if (new Set(pathAliases).size !== pathAliases.length) {
    fail('OPS_INPUTS_PATH_ALIAS_COLLISION');
  }
  if (
    inputs.trackedFileCount !== inputs.trackedFiles.length ||
    inputs.trackedInventorySha256 !== hash(JSON.stringify(inputs.trackedFiles))
  ) {
    fail('OPS_INPUTS_TRACKED_DIGEST_MISMATCH');
  }
  if (JSON.stringify(generatedPaths) !== JSON.stringify(GENERATED_ROOTS)) {
    fail('OPS_INPUTS_GENERATED_ROOTS_INVALID');
  }
  if (
    inputs.generatedRootCount !== inputs.generatedRoots.length ||
    inputs.generatedInventorySha256 !== hash(JSON.stringify(inputs.generatedRoots))
  ) {
    fail('OPS_INPUTS_GENERATED_DIGEST_MISMATCH');
  }
  const universe = frozenUniverse(inputs);
  if (inputs.frozenUniverseSha256 !== hash(JSON.stringify(universe))) {
    fail('OPS_INPUTS_FROZEN_UNIVERSE_MISMATCH');
  }
  assertSafeEvidenceJson(inputs);
  return inputs;
}

function validateFrozenUniverse(parsedLedger, inputValue) {
  const inputs = validateOpsInputs(inputValue);
  const expected = frozenUniverse(inputs);
  const actualByPath = new Map(parsedLedger.entries.map((item) => [item.sourcePath, item]));
  const expectedByPath = new Map(expected.map((item) => [item.sourcePath, item]));
  for (const expectedItem of expected) {
    const actualItem = actualByPath.get(expectedItem.sourcePath);
    if (!actualItem) fail('OPS_DISPOSITION_FROZEN_MISSING');
    if (
      actualItem.sourceAlias !== expectedItem.sourceAlias ||
      actualItem.sourceKind !== expectedItem.sourceKind ||
      actualItem.sourceGitBlobSha !== expectedItem.sourceGitBlobSha ||
      actualItem.sourceSha256 !== expectedItem.sourceSha256
    ) {
      fail('OPS_DISPOSITION_FROZEN_DIGEST_MISMATCH');
    }
  }
  for (const actualItem of parsedLedger.entries) {
    if (!expectedByPath.has(actualItem.sourcePath)) fail('OPS_DISPOSITION_FROZEN_UNEXPECTED');
  }
  return parsedLedger;
}

function validate(value, allowPending) {
  if (value?.schemaVersion === 1 && Array.isArray(value.entries) && value.entries.length === 0) {
    fail('OPS_DISPOSITION_EMPTY');
  }
  if (Array.isArray(value?.entries)) {
    for (const item of value.entries) {
      if (
        typeof item?.sourcePath !== 'string' ||
        !relativePath.safeParse(item.sourcePath).success
      ) {
        fail('OPS_DISPOSITION_PATH_INVALID');
      }
      if (
        typeof item?.disposition !== 'string' ||
        !disposition.safeParse(item.disposition).success
      ) {
        fail('OPS_DISPOSITION_UNKNOWN');
      }
      if (
        item?.targetPath !== null &&
        (typeof item?.targetPath !== 'string' || !relativePath.safeParse(item.targetPath).success)
      ) {
        fail('OPS_DISPOSITION_TARGET_PATH_INVALID');
      }
      if (
        Array.isArray(item?.evidence) &&
        item.evidence.some((evidencePath) => !relativePath.safeParse(evidencePath).success)
      ) {
        fail('OPS_DISPOSITION_EVIDENCE_PATH_INVALID');
      }
    }
  }
  const parsed = ledger.safeParse(value);
  if (!parsed.success) fail('OPS_DISPOSITION_SCHEMA_INVALID');
  const seen = new Set();
  const seenAliases = new Set();
  for (const item of parsed.data.entries) {
    const identity = `${item.sourceAlias}\0${item.sourcePath}`;
    if (seen.has(identity)) fail('OPS_DISPOSITION_DUPLICATE_SOURCE');
    seen.add(identity);
    const identityAlias = `${item.sourceAlias.toLowerCase()}\0${item.sourcePath.toLowerCase()}`;
    if (seenAliases.has(identityAlias)) fail('OPS_DISPOSITION_PATH_ALIAS_COLLISION');
    seenAliases.add(identityAlias);
    if (item.capturedAt !== parsed.data.capturedAt) fail('OPS_DISPOSITION_TIMESTAMP_MISMATCH');
    if (item.sourceKind === 'generated-root' && item.sourceGitBlobSha !== null) {
      fail('OPS_DISPOSITION_GENERATED_BLOB_FORBIDDEN');
    }
    if (item.sourceKind === 'git-blob' && item.sourceGitBlobSha === null) {
      fail('OPS_DISPOSITION_GIT_BLOB_REQUIRED');
    }
    if (item.disposition === 'pending' && !allowPending) fail('OPS_DISPOSITION_PENDING');
    if (
      ['integrate', 'superseded'].includes(item.disposition) &&
      (!item.targetPath ||
        !item.replacementSha ||
        !item.targetGitBlobSha ||
        !item.targetContentSha256)
    ) {
      fail('OPS_DISPOSITION_REPLACEMENT_REQUIRED');
    }
    if (
      ['generated', 'pending'].includes(item.disposition) &&
      (item.targetPath !== null ||
        item.targetGitBlobSha !== null ||
        item.targetContentSha256 !== null ||
        item.replacementSha !== null ||
        item.evidenceIdentities.length !== 0)
    ) {
      fail('OPS_DISPOSITION_TARGET_FORBIDDEN');
    }
    if (['integrate', 'superseded'].includes(item.disposition)) {
      if (
        item.evidence.length !== item.evidenceIdentities.length ||
        item.evidence.some(
          (evidencePath, index) => item.evidenceIdentities[index].path !== evidencePath
        )
      ) {
        fail('OPS_DISPOSITION_EVIDENCE_IDENTITY_MISMATCH');
      }
      if (!item.evidence.includes(item.targetPath)) {
        fail('OPS_DISPOSITION_EVIDENCE_TARGET_REQUIRED');
      }
    }
  }
  for (let index = 1; index < parsed.data.entries.length; index += 1) {
    if (
      compareText(
        parsed.data.entries[index - 1].sourcePath,
        parsed.data.entries[index].sourcePath
      ) >= 0
    ) {
      fail('OPS_DISPOSITION_ORDER_INVALID');
    }
  }
  assertSafeEvidenceJson(parsed.data);
  if (allowPending && parsed.data.state !== 'construction') {
    fail('OPS_DISPOSITION_CONSTRUCTION_STATE_REQUIRED');
  }
  if (!allowPending && parsed.data.state !== 'final') {
    fail('OPS_DISPOSITION_CONSTRUCTION_ONLY');
  }
  return parsed.data;
}

export function validateOpsDisposition(value) {
  const parsed = validate(value, false);
  if (mappingEntries(parsed).length > 0) fail('OPS_DISPOSITION_FINAL_PROOF_REQUIRED');
  return parsed;
}

export function validateOpsDispositionForConstruction(value, inputs) {
  const parsed = validate(value, true);
  return inputs === undefined ? parsed : validateFrozenUniverse(parsed, inputs);
}

export function buildFrozenOpsCapture({
  canonicalRepositoryRoot,
  canonicalGitSha,
  embeddedRepositoryRoot,
  embeddedGitSha,
  embeddedWorktreeRoot,
  capturedAt,
  runtimeIdentity
}) {
  const canonicalTreeSha = requireFullCommit(canonicalRepositoryRoot, canonicalGitSha);
  const embeddedTreeSha = requireFullCommit(embeddedRepositoryRoot, embeddedGitSha);
  const tracked = captureTrackedGitInventory({
    repositoryRoot: embeddedRepositoryRoot,
    commitSha: embeddedGitSha
  });
  const generatedRoots = GENERATED_ROOTS.map((sourcePath) =>
    captureGeneratedRoot(path.join(embeddedWorktreeRoot, sourcePath), sourcePath)
  );
  const inputs = {
    schemaVersion: 1,
    capturedAt,
    canonical: {
      repository: 'edutrack-ops',
      sourceAlias: 'canonical-ops',
      gitSha: canonicalGitSha,
      treeSha: canonicalTreeSha
    },
    embedded: {
      repository: 'embedded-ops-console',
      sourceAlias: 'embedded-console',
      gitSha: embeddedGitSha,
      treeSha: embeddedTreeSha
    },
    runtimeIdentity,
    trackedPrefix: 'ops-console',
    trackedFileCount: tracked.count,
    trackedInventorySha256: tracked.inventorySha256,
    trackedFiles: tracked.entries,
    generatedRootCount: generatedRoots.length,
    generatedInventorySha256: hash(JSON.stringify(generatedRoots)),
    generatedRoots,
    frozenUniverseSha256: ''
  };
  inputs.frozenUniverseSha256 = hash(JSON.stringify(frozenUniverse(inputs)));
  const ledgerEntries = frozenUniverse(inputs).map((item) => ({
    ...item,
    targetRepository: 'edutrack-ops',
    targetPath: null,
    targetGitBlobSha: null,
    targetContentSha256: null,
    disposition: item.sourceKind === 'generated-root' ? 'generated' : 'pending',
    replacementSha: null,
    evidence: [INPUT_EVIDENCE_PATH],
    evidenceIdentities: [],
    capturedAt
  }));
  const result = {
    inputs: validateOpsInputs(inputs),
    ledger: { schemaVersion: 1, state: 'construction', capturedAt, entries: ledgerEntries }
  };
  validateOpsDispositionForConstruction(result.ledger, result.inputs);
  return result;
}

export function validateFinalOpsDisposition(value, inputs, options) {
  const parsedInputs = validateOpsInputs(inputs);
  const parsedLedger = validateFrozenUniverse(validate(value, false), parsedInputs);
  return validateFinalMappingGit(parsedLedger, parsedInputs, options);
}

const CANONICAL_GIT_SHA = '4313023f483b48d81cab45174db38fc893900444';
const EMBEDDED_GIT_SHA = '5dff838be4f4b60232cf4a8c34b6292c35c489dc';
const CAPTURED_AT = '2026-08-30T05:17:12.000Z';
const RUNTIME_IDENTITY = {
  currentReleaseName: 'beszel-disabled-20260824-1458',
  services: [
    {
      name: 'edutrack-ops-collector.service',
      activeState: 'active',
      subState: 'running',
      fragmentScope: 'system'
    },
    {
      name: 'edutrack-ops-web.service',
      activeState: 'active',
      subState: 'running',
      fragmentScope: 'system'
    }
  ]
};

function readJson(filePath, errorCode) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    fail(errorCode);
  }
}

function writeExclusiveReplacement(filePath, bytes) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.capture-${process.pid}`;
  writeFileSync(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

function captureFromReviewedInputs(repositoryRoot) {
  const embeddedWorktreeRoot = git(repositoryRoot, [
    'remote',
    'get-url',
    'embedded-console'
  ]).trim();
  if (!path.isAbsolute(embeddedWorktreeRoot)) fail('OPS_EMBEDDED_WORKTREE_INVALID');
  const embeddedHead = git(embeddedWorktreeRoot, ['rev-parse', 'HEAD']).trim();
  if (embeddedHead !== EMBEDDED_GIT_SHA) fail('OPS_EMBEDDED_WORKTREE_MOVED');
  return buildFrozenOpsCapture({
    canonicalRepositoryRoot: repositoryRoot,
    canonicalGitSha: CANONICAL_GIT_SHA,
    embeddedRepositoryRoot: repositoryRoot,
    embeddedGitSha: EMBEDDED_GIT_SHA,
    embeddedWorktreeRoot,
    capturedAt: CAPTURED_AT,
    runtimeIdentity: RUNTIME_IDENTITY
  });
}

function main() {
  const args = process.argv.slice(2);
  const repositoryRoot = process.cwd();
  if (args.length === 1 && args[0] === '--capture') {
    const captured = captureFromReviewedInputs(repositoryRoot);
    const baselineDirectory = path.join(repositoryRoot, 'docs/architecture/baselines');
    const inputsBytes = assertSafeEvidenceJson(captured.inputs);
    const ledgerBytes = assertSafeEvidenceJson(captured.ledger);
    writeExclusiveReplacement(
      path.join(baselineDirectory, '2026-08-29-ops-consolidation-inputs.json'),
      inputsBytes
    );
    writeExclusiveReplacement(
      path.join(baselineDirectory, '2026-08-29-ops-disposition-ledger.json'),
      ledgerBytes
    );
    console.log(
      `OPS_DISPOSITION_CAPTURE_PASS tracked=${captured.inputs.trackedFileCount} generated=${captured.inputs.generatedRootCount} universe=${captured.ledger.entries.length}`
    );
    return;
  }
  if (args.length !== 1 || !args[0].endsWith('.json')) {
    fail('OPS_DISPOSITION_ARGUMENTS_INVALID');
  }
  const ledgerPath = path.resolve(args[0]);
  if (path.basename(ledgerPath) !== '2026-08-29-ops-disposition-ledger.json') {
    fail('OPS_DISPOSITION_ARGUMENTS_INVALID');
  }
  const inputsPath = path.join(
    path.dirname(ledgerPath),
    '2026-08-29-ops-consolidation-inputs.json'
  );
  const validated = validateFinalOpsDisposition(
    readJson(ledgerPath, 'OPS_DISPOSITION_JSON_INVALID'),
    readJson(inputsPath, 'OPS_INPUTS_JSON_INVALID'),
    { repositoryRoot, headSha: 'HEAD' }
  );
  console.log(`OPS_DISPOSITION_PASS entries=${validated.entries.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error?.code ?? error?.message ?? 'OPS_DISPOSITION_UNKNOWN_ERROR');
    process.exitCode = 1;
  }
}
