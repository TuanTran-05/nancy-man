import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

import ts from 'typescript';

import { parseCatalog, type Catalog, type CatalogEntry } from '../../packages/config-contracts/src/catalog.ts';
import {
  parseAgentManifest,
  type AgentManifest,
  type ManifestSource,
  type SourceLocator
} from '../../packages/config-contracts/src/manifest.ts';

type CliOptions = {
  manifestPath: string;
  catalogPath: string;
  repoRoots: string[];
};

type ReferenceSeverity = 'observed' | 'required';

type ReferenceFinding = {
  name: string;
  severity: ReferenceSeverity;
};

export type RepositoryReferenceReport = {
  names: string[];
  requiredNames: string[];
  manualReview: string[];
};

export type CatalogCoverageReport = {
  catalogedActive: string[];
  unknownActive: string[];
  missingRequired: string[];
  staleCatalog: string[];
};

type ActiveDefinition = {
  appId: string;
  sourceId: string;
  name: string;
};

const codeExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const envNamePattern = /^[A-Z][A-Z0-9_]*$/u;
const skippedPathSegments = new Set([
  '.git',
  '.worktrees',
  '.superdesign',
  'coverage',
  'dist',
  'docs',
  'node_modules'
]);
const skippedFilePattern =
  /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;

function fail(code: string): never {
  throw new Error(code);
}

function stableNameId(name: string): string {
  return name.toLowerCase();
}

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isProcessEnv(expression: ts.Expression): expression is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'process' &&
    expression.name.text === 'env'
  );
}

function isImportMetaEnv(expression: ts.Node): expression is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'env' &&
    ts.isMetaProperty(expression.expression) &&
    expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    expression.expression.name.text === 'meta'
  );
}

function collectStringArray(node: ts.Expression | undefined): string[] | null {
  if (!node || !ts.isArrayLiteralExpression(node)) return null;
  const values: string[] = [];
  for (const element of node.elements) {
    if (!ts.isStringLiteralLike(element) || !envNamePattern.test(element.text)) return null;
    values.push(element.text);
  }
  return values;
}

function collectEnvObjectNames(node: ts.ObjectLiteralExpression): string[] {
  const values: string[] = [];
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText().replace(/^['"]|['"]$/g, '');
    if (envNamePattern.test(name)) values.push(name);
  }
  return values;
}

function findEnvReadsInNode(node: ts.Node, parameterName: string): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) return;
    if (
      ts.isElementAccessExpression(current) &&
      isProcessEnv(current.expression) &&
      ts.isIdentifier(current.argumentExpression) &&
      current.argumentExpression.text === parameterName
    ) {
      found = true;
      return;
    }
    current.forEachChild(visit);
  };
  visit(node);
  return found;
}

function findHelperReaders(sourceFile: ts.SourceFile): Set<string> {
  const readers = new Set<string>();

  const inspect = (name: string, parameters: readonly ts.ParameterDeclaration[], body: ts.Node | undefined) => {
    const first = parameters[0];
    if (!body || !first || !ts.isIdentifier(first.name)) return;
    if (findEnvReadsInNode(body, first.name.text)) readers.add(name);
  };

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      inspect(node.name.text, node.parameters, node.body);
    }
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.flags & ts.NodeFlags.Const
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
        ) {
          inspect(
            declaration.name.text,
            declaration.initializer.parameters,
            declaration.initializer.body
          );
        }
      }
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return readers;
}

function looksRequired(functionName: string): boolean {
  return new Set([
    'required',
    'requiredCredentialReference',
    'requiredAbsolutePath',
    'requiredBoolean',
    'requiredKey',
    'requiredSecret',
    'credential',
    'absolutePath',
    'postgresName',
    'requireLoopbackUrl'
  ]).has(functionName);
}

function fileLine(sourceFile: ts.SourceFile, position: number): string {
  const { line } = sourceFile.getLineAndCharacterOfPosition(position);
  return `${sourceFile.fileName}:${line + 1}`;
}

function parseCodeReferences(text: string, filePath: string): RepositoryReferenceReport {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helperReaders = findHelperReaders(sourceFile);
  const findings: ReferenceFinding[] = [];
  const manualReview = new Set<string>();
  const arrays = new Map<string, string[]>();

  const addFinding = (name: string, severity: ReferenceSeverity) => {
    if (!envNamePattern.test(name)) return;
    findings.push({ name, severity });
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.flags & ts.NodeFlags.Const
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const values = collectStringArray(declaration.initializer);
          if (values) arrays.set(declaration.name.text, values);
        }
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      isProcessEnv(node.expression) &&
      envNamePattern.test(node.name.text)
    ) {
      addFinding(node.name.text, 'observed');
    }

    if (
      ts.isElementAccessExpression(node) &&
      isProcessEnv(node.expression) &&
      node.argumentExpression
    ) {
      if (ts.isStringLiteralLike(node.argumentExpression) && envNamePattern.test(node.argumentExpression.text)) {
        addFinding(node.argumentExpression.text, 'observed');
      } else if (!ts.isIdentifier(node.argumentExpression)) {
        manualReview.add(fileLine(sourceFile, node.getStart(sourceFile)));
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      isImportMetaEnv(node.expression) &&
      envNamePattern.test(node.name.text)
    ) {
      addFinding(node.name.text, 'observed');
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const objectName = ts.isIdentifier(node.expression.expression)
        ? node.expression.expression.text
        : null;
      const arrayValues = objectName ? arrays.get(objectName) : null;
      if (
        arrayValues &&
        ['filter', 'forEach', 'map', 'some', 'every'].includes(node.expression.name.text) &&
        node.arguments.length > 0
      ) {
        const callback = node.arguments[0];
        if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters[0]) {
          const parameter = callback.parameters[0];
          if (ts.isIdentifier(parameter.name) && findEnvReadsInNode(callback.body, parameter.name.text)) {
            const severity: ReferenceSeverity =
              /required|missing/iu.test(objectName) || node.expression.name.text === 'every'
                ? 'required'
                : 'observed';
            for (const name of arrayValues) addFinding(name, severity);
          }
        }
      }
    }

    if (ts.isForOfStatement(node) && ts.isIdentifier(node.expression)) {
      const arrayValues = arrays.get(node.expression.text);
      const declaration = node.initializer;
      if (
        arrayValues &&
        ts.isVariableDeclarationList(declaration) &&
        declaration.declarations[0] &&
        ts.isIdentifier(declaration.declarations[0].name) &&
        findEnvReadsInNode(node.statement, declaration.declarations[0].name.text)
      ) {
        const severity: ReferenceSeverity = /required|missing/iu.test(node.expression.text)
          ? 'required'
          : 'observed';
        for (const name of arrayValues) addFinding(name, severity);
      }
    }

    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const callName =
        ts.isIdentifier(expression)
          ? expression.text
          : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)
            ? expression.name.text
            : null;
      if (callName && (helperReaders.has(callName) || looksRequired(callName)) && node.arguments.length > 0) {
        for (const argument of node.arguments) {
          if (ts.isStringLiteralLike(argument) && envNamePattern.test(argument.text)) {
            addFinding(argument.text, 'required');
          }
        }
      }
    }

    if (ts.isPropertyAssignment(node) && node.name.getText() === 'env' && ts.isObjectLiteralExpression(node.initializer)) {
      for (const name of collectEnvObjectNames(node.initializer)) addFinding(name, 'observed');
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);

  return {
    names: sortUnique(findings.map((finding) => finding.name)),
    requiredNames: sortUnique(
      findings.filter((finding) => finding.severity === 'required').map((finding) => finding.name)
    ),
    manualReview: sortUnique(manualReview)
  };
}

function parseSystemdReferences(text: string): RepositoryReferenceReport {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const environmentFile = trimmed.match(/^EnvironmentFile=(.+)$/u);
    if (environmentFile) names.add(environmentFile[1].trim());
    const credential = trimmed.match(/^LoadCredential=([^:]+):/u);
    if (credential) names.add(credential[1].trim());
  }
  return { names: sortUnique(names), requiredNames: [], manualReview: [] };
}

async function walkFiles(root: string): Promise<string[]> {
  const queue = [root];
  const files: string[] = [];
  const repoName = basename(root).toLowerCase();
  const scopedTopLevel =
    repoName.includes('edutrack-platform')
      ? new Set(['server', 'src', 'deploy'])
      : repoName.includes('edutrack-ops')
        ? new Set(['apps', 'packages', 'deploy', 'scripts'])
        : null;

  while (queue.length > 0) {
    const directory = queue.pop();
    if (!directory) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (skippedPathSegments.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (directory === root && scopedTopLevel && !scopedTopLevel.has(entry.name)) continue;
      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      if (skippedFilePattern.test(entry.name)) continue;
      if (
        repoName.includes('edutrack-platform') &&
        absolute.includes('/scripts/')
      ) {
        continue;
      }
      if (
        repoName.includes('edutrack-platform') &&
        absolute.endsWith('/deploy/vps/prepare-environment.mjs')
      ) {
        continue;
      }
      files.push(absolute);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function mergeRepositoryReports(reports: RepositoryReferenceReport[]): RepositoryReferenceReport {
  return {
    names: sortUnique(reports.flatMap((report) => report.names)),
    requiredNames: sortUnique(reports.flatMap((report) => report.requiredNames)),
    manualReview: sortUnique(reports.flatMap((report) => report.manualReview))
  };
}

export async function scanRepositoryReferences(input: {
  repoRoot: string;
}): Promise<RepositoryReferenceReport> {
  const files = await walkFiles(input.repoRoot);
  const reports: RepositoryReferenceReport[] = [];

  for (const file of files) {
    const extension = extname(file);
    const text = await readFile(file, 'utf8');
    if (codeExtensions.has(extension)) {
      reports.push(parseCodeReferences(text, file));
      continue;
    }
    if (extension === '.service' || extension === '.template' || basename(file) === 'crontab') {
      reports.push(parseSystemdReferences(text));
    }
  }

  const merged = mergeRepositoryReports(reports);
  const normalized = input.repoRoot.toLowerCase();
  if (normalized.includes('/edutrack-ops')) {
    return {
      names: merged.names,
      requiredNames: [],
      manualReview: merged.manualReview
    };
  }
  return merged;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function catalogDigest(catalog: Catalog): string {
  const json = `${JSON.stringify(canonicalize(catalog))}\n`;
  return `sha256:${createHash('sha256').update(json).digest('hex')}`;
}

async function resolveSourcePath(locator: SourceLocator): Promise<string | null> {
  if (locator.kind === 'file') return locator.path;

  const currentPath = await realpath(locator.currentPath).catch(() => null);
  if (!currentPath) return null;
  const approvedRoot = await realpath(locator.approvedTargetRoot).catch(() => null);
  if (!approvedRoot) return null;
  if (currentPath !== approvedRoot && !currentPath.startsWith(`${approvedRoot}/`)) {
    fail('VARIABLES_COVERAGE_RELEASE_TARGET_INVALID');
  }
  return join(currentPath, locator.fixedDescendant);
}

function envNamesFromText(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u)?.[1] ?? null)
    .filter((value): value is string => value !== null && envNamePattern.test(value));
}

function pm2NamesFromText(text: string, filePath: string): string[] {
  return parseCodeReferences(text, filePath).names.filter((name) => envNamePattern.test(name));
}

async function readSourceNames(source: ManifestSource): Promise<string[]> {
  if (source.adapterId === 'systemd_credential_file' || source.adapterId === 'none') return [];
  const resolved = await resolveSourcePath(source.locator);
  if (!resolved) fail(`VARIABLES_COVERAGE_SOURCE_MISSING:${source.id}`);
  const sourceStat = await stat(resolved).catch(() => null);
  if (!sourceStat?.isFile()) fail(`VARIABLES_COVERAGE_SOURCE_INVALID:${source.id}`);
  if (sourceStat.size > source.maximumBytes) fail(`VARIABLES_COVERAGE_SOURCE_OVERSIZE:${source.id}`);
  const text = await readFile(resolved, 'utf8');
  if (
    source.adapterId === 'node_env_file' ||
    source.adapterId === 'systemd_environment_file' ||
    source.adapterId === 'dotenv'
  ) {
    return sortUnique(envNamesFromText(text));
  }
  if (source.adapterId === 'pm2_ecosystem_static') {
    return sortUnique(pm2NamesFromText(text, resolved));
  }
  return [];
}

function inferAppId(repoRoot: string): string {
  const normalized = repoRoot.toLowerCase();
  const repoName = basename(repoRoot).toLowerCase();
  if (normalized.includes('/edutrack-platform')) return 'edutrack';
  if (normalized.includes('/edutrack-ops')) return 'ops';
  if (repoName.includes('edutrack-platform')) return 'edutrack';
  if (repoName.includes('edutrack-ops') || repoName.includes('ops-variables-task')) return 'ops';
  if (repoName.includes('website')) return 'website';
  return 'edutrack';
}

function syntheticId(appId: string, name: string): string {
  return `${appId}.${stableNameId(name)}`;
}

function buildCatalogLookup(catalog: Catalog): Map<string, CatalogEntry> {
  const byComposite = new Map<string, CatalogEntry>();
  for (const entry of catalog.entries) {
    const key = `${entry.appId}\u0000${entry.sourceId}\u0000${entry.name}`;
    if (byComposite.has(key)) fail(`VARIABLES_COVERAGE_DUPLICATE_CATALOG_ENTRY:${entry.id}`);
    byComposite.set(key, entry);
  }
  return byComposite;
}

export async function runCatalogCoverage(input: CliOptions): Promise<CatalogCoverageReport> {
  const catalog = parseCatalog(await readFile(input.catalogPath, 'utf8'));
  const manifest = parseAgentManifest(await readFile(input.manifestPath, 'utf8'));

  if (manifest.catalogVersion !== catalog.catalogVersion) {
    fail('VARIABLES_COVERAGE_CATALOG_VERSION_MISMATCH');
  }
  if (manifest.catalogDigest !== catalogDigest(catalog)) {
    fail('VARIABLES_COVERAGE_CATALOG_DIGEST_MISMATCH');
  }

  const activeDefinitions: ActiveDefinition[] = [];
  for (const source of manifest.sources) {
    for (const name of await readSourceNames(source)) {
      activeDefinitions.push({ appId: source.appId, sourceId: source.id, name });
    }
  }

  const repoReports = await Promise.all(input.repoRoots.map((repoRoot) => scanRepositoryReferences({ repoRoot })));
  const repoReport = mergeRepositoryReports(repoReports);
  if (repoReport.manualReview.length > 0) {
    fail(`VARIABLES_COVERAGE_MANUAL_REVIEW_REQUIRED:${repoReport.manualReview.join(',')}`);
  }

  const catalogLookup = buildCatalogLookup(catalog);
  const activeCatalogIds = new Set<string>();
  const unknownActive = new Set<string>();

  for (const definition of activeDefinitions) {
    const directKey = `${definition.appId}\u0000${definition.sourceId}\u0000${definition.name}`;
    const entry = catalogLookup.get(directKey);
    if (entry) {
      activeCatalogIds.add(entry.id);
    } else {
      unknownActive.add(syntheticId(definition.appId, definition.name));
    }
  }

  const activeNamesByApp = new Map<string, Set<string>>();
  for (const definition of activeDefinitions) {
    const set = activeNamesByApp.get(definition.appId) ?? new Set<string>();
    set.add(definition.name);
    activeNamesByApp.set(definition.appId, set);
  }

  const missingRequired = new Set<string>();
  for (let index = 0; index < repoReports.length; index += 1) {
    const appId = inferAppId(input.repoRoots[index]);
    const activeNames = activeNamesByApp.get(appId) ?? new Set<string>();
    for (const name of repoReports[index].requiredNames) {
      if (!activeNames.has(name)) missingRequired.add(syntheticId(appId, name));
    }
  }

  const staleCatalog = new Set<string>();
  for (const entry of catalog.entries) {
    if (!activeCatalogIds.has(entry.id)) {
      const activeNames = activeNamesByApp.get(entry.appId);
      if (!activeNames || !activeNames.has(entry.name)) staleCatalog.add(entry.id);
    }
  }

  return {
    catalogedActive: sortUnique(activeCatalogIds),
    unknownActive: sortUnique(unknownActive),
    missingRequired: sortUnique(missingRequired),
    staleCatalog: sortUnique(staleCatalog)
  };
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { manifestPath: '', catalogPath: '', repoRoots: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--manifest' && value) {
      options.manifestPath = resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--catalog' && value) {
      options.catalogPath = resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--repo' && value) {
      options.repoRoots.push(resolve(value));
      index += 1;
      continue;
    }
    fail('VARIABLES_COVERAGE_USAGE');
  }

  if (!options.manifestPath || !options.catalogPath || options.repoRoots.length === 0) {
    fail('VARIABLES_COVERAGE_USAGE');
  }

  return options;
}

async function main(argv: readonly string[]): Promise<void> {
  const report = await runCatalogCoverage(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.missingRequired.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'VARIABLES_COVERAGE_FAILED'}\n`);
    process.exitCode = 1;
  });
}
