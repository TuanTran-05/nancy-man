import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export type ErrorTelemetryRule = 'UNCAPTURED_CATCH' | 'UNCAPTURED_PROMISE_REJECTION';

export type ErrorTelemetryFinding = {
  path: string;
  line: number;
  column: number;
  rule: ErrorTelemetryRule;
  message: string;
};

type Boundary = {
  body: ts.Node;
  binding?: ts.Identifier;
  diagnosticNode: ts.Node;
  finalizer?: ts.Block;
  rule: ErrorTelemetryRule;
};

const facadeExports = new Set(['captureOpsException', 'captureBrowserException']);
const excludedDirectoryNames = new Set([
  '.generated',
  '__tests__',
  'coverage',
  'dist',
  'dist-esp',
  'fixtures',
  'generated',
  'node_modules',
  'vendor'
]);

export function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

export function isExcludedPath(filePath: string): boolean {
  const normalized = `/${normalizePath(filePath).replace(/^\/+/, '')}`;
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments.at(-1) ?? '';
  if (segments.some((segment) => excludedDirectoryNames.has(segment))) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(fileName)) return true;
  if (/\.generated\.[cm]?[jt]sx?$/.test(fileName)) return true;
  return (
    normalized.startsWith('/packages/test-utils/') ||
    normalized.startsWith('/packages/telemetry-sdk/src/') ||
    normalized.startsWith('/packages/security/src/telemetry/') ||
    normalized.startsWith('/apps/api/src/modules/ingest/') ||
    /\/apps\/(?:api|config-agent|notifier|processor|sql-worker)\/src\/telemetry\/runtimeTelemetry\.[cm]?[jt]sx?$/.test(
      normalized
    ) ||
    /\/apps\/web\/src\/(?:server|web)\/telemetry\/runtimeTelemetry\.[cm]?[jt]sx?$/.test(normalized)
  );
}

export function isProductionSourcePath(filePath: string, root = process.cwd()): boolean {
  const relative = normalizePath(
    path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath
  );
  return (
    !relative.startsWith('../') &&
    /^(?:apps|packages)\/[^/]+\/src\/.+\.[cm]?[jt]sx?$/.test(relative) &&
    !isExcludedPath(relative)
  );
}

function repositoryRelativeSourcePath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/(?:^|\/)(?:apps|packages)\/[^/]+\/src\//);
  if (!match || match.index === undefined) return normalized.replace(/^\/+/, '');
  return normalized.slice(match.index + (match[0].startsWith('/') ? 1 : 0));
}

function resolvedRepositoryModule(filePath: string, modulePath: string): string | undefined {
  let resolved: string;
  if (modulePath.startsWith('@/')) {
    resolved = modulePath.slice(2);
  } else if (modulePath.startsWith('.')) {
    resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(repositoryRelativeSourcePath(filePath)), modulePath)
    );
  } else {
    return undefined;
  }
  return normalizePath(resolved).replace(/\.(?:[cm]?[jt]sx?)$/, '');
}

export function isRuntimeFacadeModule(
  filePath: string,
  exported: string,
  modulePath: string
): boolean {
  const normalized = repositoryRelativeSourcePath(filePath);
  const resolved = resolvedRepositoryModule(filePath, modulePath);
  if (!resolved) return false;
  if (normalized.startsWith('apps/web/src/web/')) {
    return (
      exported === 'captureBrowserException' &&
      resolved === 'apps/web/src/web/telemetry/runtimeTelemetry'
    );
  }
  if (exported !== 'captureOpsException') return false;
  if (normalized.startsWith('packages/')) {
    return resolved === 'packages/telemetry-sdk/src/runtimeCaptureFacade';
  }
  const app = normalized.match(/^apps\/([^/]+)\/src\//)?.[1];
  if (!app) return false;
  const expected =
    app === 'web'
      ? 'apps/web/src/server/telemetry/runtimeTelemetry'
      : `apps/${app}/src/telemetry/runtimeTelemetry`;
  return resolved === expected;
}

function importedFacades(sourceFile: ts.SourceFile, filePath: string): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      for (const exported of facadeExports) {
        if (isRuntimeFacadeModule(filePath, exported, statement.moduleSpecifier.text)) {
          imports.set(`${bindings.name.text}.${exported}`, exported);
        }
      }
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const exported = (element.propertyName ?? element.name).text;
      if (
        facadeExports.has(exported) &&
        isRuntimeFacadeModule(filePath, exported, statement.moduleSpecifier.text)
      ) {
        imports.set(element.name.text, exported);
      }
    }
  }
  return imports;
}

function sourceFileTypeChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
  const fileName = sourceFile.fileName;
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.ES2022
  };
  const host: ts.CompilerHost = {
    fileExists: (candidate) => candidate === fileName,
    getCanonicalFileName: (candidate) => candidate,
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => 'lib.d.ts',
    getDirectories: () => [],
    getNewLine: () => '\n',
    getSourceFile: (candidate) => (candidate === fileName ? sourceFile : undefined),
    readFile: (candidate) => (candidate === fileName ? sourceFile.text : undefined),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined
  };
  return ts.createProgram({ host, options, rootNames: [fileName] }).getTypeChecker();
}

function staticElementAccessName(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;
  const unwrapped = unwrapExpression(expression);
  return ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)
    ? unwrapped.text
    : undefined;
}

function facadeReference(
  expression: ts.Expression,
  facades: Map<string, string>
): { binding: ts.Identifier; facade: string } | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    const facade = facades.get(unwrapped.text);
    return facade ? { binding: unwrapped, facade } : undefined;
  }
  const receiver =
    ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)
      ? unwrapExpression(unwrapped.expression)
      : undefined;
  if (!receiver || !ts.isIdentifier(receiver)) return undefined;
  const property = ts.isPropertyAccessExpression(unwrapped)
    ? unwrapped.name.text
    : ts.isElementAccessExpression(unwrapped)
      ? staticElementAccessName(unwrapped.argumentExpression)
      : undefined;
  if (!property) return undefined;
  const facade = facades.get(`${receiver.text}.${property}`);
  return facade ? { binding: receiver, facade } : undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression);
    if (
      ts.isStringLiteral(expression) ||
      ts.isNumericLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text;
    }
  }
  return undefined;
}

type EffectiveObjectProperty =
  | { kind: 'absent' }
  | { kind: 'unknown' }
  | { kind: 'known'; expressions: ts.Expression[] };

function spreadObjectProperty(
  expression: ts.Expression,
  propertyName: string
): EffectiveObjectProperty {
  const unwrapped = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return effectiveObjectProperty(unwrapped, propertyName);
  }
  if (ts.isConditionalExpression(unwrapped)) {
    const whenTrue = spreadObjectProperty(unwrapped.whenTrue, propertyName);
    const whenFalse = spreadObjectProperty(unwrapped.whenFalse, propertyName);
    if (whenTrue.kind === 'absent' && whenFalse.kind === 'absent') return { kind: 'absent' };
    if (whenTrue.kind === 'known' && whenFalse.kind === 'known') {
      return {
        kind: 'known',
        expressions: [...whenTrue.expressions, ...whenFalse.expressions]
      };
    }
    return { kind: 'unknown' };
  }
  if (
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(unwrapped) &&
      unwrapped.text === 'undefined' &&
      isUnboundGlobalAtNode('undefined', unwrapped))
  ) {
    return { kind: 'absent' };
  }
  return { kind: 'unknown' };
}

function effectiveObjectProperty(
  object: ts.ObjectLiteralExpression,
  propertyName: string
): EffectiveObjectProperty {
  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const property = object.properties[index];
    if (ts.isSpreadAssignment(property)) {
      const spread = spreadObjectProperty(property.expression, propertyName);
      if (spread.kind !== 'absent') return spread;
      continue;
    }
    const name = propertyNameText(property.name);
    if (!name) return { kind: 'unknown' };
    if (name !== propertyName) continue;
    if (ts.isShorthandPropertyAssignment(property)) {
      return { kind: 'known', expressions: [property.name] };
    }
    if (ts.isPropertyAssignment(property)) {
      return { kind: 'known', expressions: [property.initializer] };
    }
    return { kind: 'unknown' };
  }
  return { kind: 'absent' };
}

function objectDeferMode(
  object: ts.ObjectLiteralExpression,
  propertyName: string
): 'terminal' | 'provisional' | 'uncertain' {
  const effective = effectiveObjectProperty(object, propertyName);
  if (effective.kind === 'absent') return 'terminal';
  if (effective.kind === 'unknown') return 'uncertain';
  let sawTrue = false;
  let sawTerminal = false;
  for (const expression of effective.expressions) {
    const initializer = unwrapExpression(expression);
    if (initializer.kind === ts.SyntaxKind.TrueKeyword) sawTrue = true;
    else if (initializer.kind === ts.SyntaxKind.FalseKeyword) sawTerminal = true;
    else return 'uncertain';
  }
  if (sawTrue && !sawTerminal) return 'provisional';
  if (sawTerminal && !sawTrue) return 'terminal';
  return 'uncertain';
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isAliasExpression(expression: ts.Expression, aliases: Set<string>): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isIdentifier(unwrapped) && aliases.has(unwrapped.text);
}

function isSafelyEvaluatedClosedSpread(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(unwrapped) &&
      unwrapped.text === 'undefined' &&
      isUnboundGlobalAtNode('undefined', unwrapped))
  ) {
    return true;
  }
  if (ts.isConditionalExpression(unwrapped)) {
    return (
      isSafelyEvaluatedFacadeExpression(unwrapped.condition) &&
      isSafelyEvaluatedClosedSpread(unwrapped.whenTrue) &&
      isSafelyEvaluatedClosedSpread(unwrapped.whenFalse)
    );
  }
  if (!ts.isObjectLiteralExpression(unwrapped)) return false;
  return unwrapped.properties.every((property) => {
    if (ts.isSpreadAssignment(property)) {
      return isSafelyEvaluatedClosedSpread(property.expression);
    }
    if (ts.isGetAccessor(property) || ts.isSetAccessor(property)) return false;
    if (ts.isComputedPropertyName(property.name) && !isSafeComputedPropertyName(property.name)) {
      return false;
    }
    if (ts.isPropertyAssignment(property)) {
      return isSafelyEvaluatedFacadeExpression(property.initializer);
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      return (
        !property.objectAssignmentInitializer ||
        isSafelyEvaluatedFacadeExpression(property.objectAssignmentInitializer)
      );
    }
    return ts.isMethodDeclaration(property);
  });
}

function isSafeComputedPropertyName(name: ts.ComputedPropertyName): boolean {
  const expression = unwrapExpression(name.expression);
  return (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  );
}

function isNonCoerciveBinaryOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken ||
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.CommaToken
  );
}

function isSafelyEvaluatedFacadeExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (
    ts.isIdentifier(unwrapped) ||
    ts.isStringLiteral(unwrapped) ||
    ts.isNumericLiteral(unwrapped) ||
    ts.isBigIntLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped) ||
    ts.isRegularExpressionLiteral(unwrapped) ||
    unwrapped.kind === ts.SyntaxKind.TrueKeyword ||
    unwrapped.kind === ts.SyntaxKind.FalseKeyword ||
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    unwrapped.kind === ts.SyntaxKind.ThisKeyword ||
    ts.isArrowFunction(unwrapped) ||
    ts.isFunctionExpression(unwrapped)
  ) {
    return true;
  }
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped.properties.every((property) => {
      if (ts.isSpreadAssignment(property)) {
        return isSafelyEvaluatedClosedSpread(property.expression);
      }
      if (ts.isComputedPropertyName(property.name) && !isSafeComputedPropertyName(property.name)) {
        return false;
      }
      if (ts.isPropertyAssignment(property)) {
        return isSafelyEvaluatedFacadeExpression(property.initializer);
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return (
          !property.objectAssignmentInitializer ||
          isSafelyEvaluatedFacadeExpression(property.objectAssignmentInitializer)
        );
      }
      return ts.isMethodDeclaration(property);
    });
  }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.every(
      (element) => !ts.isSpreadElement(element) && isSafelyEvaluatedFacadeExpression(element)
    );
  }
  if (ts.isConditionalExpression(unwrapped)) {
    return (
      isSafelyEvaluatedFacadeExpression(unwrapped.condition) &&
      isSafelyEvaluatedFacadeExpression(unwrapped.whenTrue) &&
      isSafelyEvaluatedFacadeExpression(unwrapped.whenFalse)
    );
  }
  if (ts.isBinaryExpression(unwrapped)) {
    return (
      isNonCoerciveBinaryOperator(unwrapped.operatorToken.kind) &&
      isSafelyEvaluatedFacadeExpression(unwrapped.left) &&
      isSafelyEvaluatedFacadeExpression(unwrapped.right)
    );
  }
  if (ts.isPrefixUnaryExpression(unwrapped)) {
    return (
      unwrapped.operator === ts.SyntaxKind.ExclamationToken &&
      isSafelyEvaluatedFacadeExpression(unwrapped.operand)
    );
  }
  if (ts.isTypeOfExpression(unwrapped) || ts.isVoidExpression(unwrapped)) {
    return isSafelyEvaluatedFacadeExpression(unwrapped.expression);
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return isSafelyEvaluatedFacadeExpression(unwrapped.expression);
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    return (
      isSafelyEvaluatedFacadeExpression(unwrapped.expression) &&
      (!unwrapped.argumentExpression ||
        isSafelyEvaluatedFacadeExpression(unwrapped.argumentExpression))
    );
  }
  return false;
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

function declarationHasName(
  declaration: ts.VariableDeclaration | ts.ParameterDeclaration,
  name: string
): boolean {
  const names = new Set<string>();
  collectBindingNames(declaration.name, names);
  return names.has(name);
}

type LexicalBindingKind = 'declaration' | 'import';

function declarationListHasName(
  declarationList: ts.VariableDeclarationList,
  name: string
): boolean {
  return declarationList.declarations.some((declaration) => declarationHasName(declaration, name));
}

function isBlockScopedDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
  return (ts.getCombinedNodeFlags(declarationList) & ts.NodeFlags.BlockScoped) !== 0;
}

function isUsingDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
  return (ts.getCombinedNodeFlags(declarationList) & ts.NodeFlags.Using) !== 0;
}

function statementHasLexicalRuntimeName(statement: ts.Statement, name: string): boolean {
  if (ts.isVariableStatement(statement)) {
    return (
      isBlockScopedDeclarationList(statement.declarationList) &&
      declarationListHasName(statement.declarationList, name)
    );
  }
  return (
    ((ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)) &&
      statement.name?.getText() === name) ||
    (ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.name.text === name)
  );
}

function scopeHasHoistedVar(
  scope: ts.SourceFile | ts.SignatureDeclaration | ts.ModuleBlock,
  name: string
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      node !== scope &&
      (ts.isFunctionLike(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isModuleDeclaration(node))
    ) {
      return;
    }
    if (
      ts.isVariableDeclarationList(node) &&
      !isBlockScopedDeclarationList(node) &&
      declarationListHasName(node, name)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

function sourceFileImportKind(
  sourceFile: ts.SourceFile,
  name: string
): LexicalBindingKind | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name?.text === name) return 'import';
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) return 'import';
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => !element.isTypeOnly && element.name.text === name)
    ) {
      return 'import';
    }
  }
  return undefined;
}

function scopeBindingKind(scope: ts.Node, name: string): LexicalBindingKind | undefined {
  if (
    ((ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope)) &&
      scope.name?.text === name) ||
    ((ts.isClassDeclaration(scope) || ts.isClassExpression(scope)) && scope.name?.text === name)
  ) {
    return 'declaration';
  }
  if (
    ts.isFunctionLike(scope) &&
    scope.parameters.some((parameter) => declarationHasName(parameter, name))
  ) {
    return 'declaration';
  }
  if (
    ts.isCatchClause(scope) &&
    scope.variableDeclaration &&
    declarationHasName(scope.variableDeclaration, name)
  ) {
    return 'declaration';
  }
  if (
    (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer) &&
    isBlockScopedDeclarationList(scope.initializer)
  ) {
    return declarationListHasName(scope.initializer, name) ? 'declaration' : undefined;
  }
  if (ts.isCaseBlock(scope)) {
    for (const clause of scope.clauses) {
      if (clause.statements.some((statement) => statementHasLexicalRuntimeName(statement, name))) {
        return 'declaration';
      }
    }
    return undefined;
  }
  if (ts.isBlock(scope)) {
    return scope.statements.some((statement) => statementHasLexicalRuntimeName(statement, name))
      ? 'declaration'
      : undefined;
  }
  if (ts.isModuleBlock(scope)) {
    if (scopeHasHoistedVar(scope, name)) return 'declaration';
    return scope.statements.some((statement) => statementHasLexicalRuntimeName(statement, name))
      ? 'declaration'
      : undefined;
  }
  if (ts.isFunctionLike(scope)) {
    return scopeHasHoistedVar(scope, name) ? 'declaration' : undefined;
  }
  if (!ts.isSourceFile(scope)) return undefined;
  if (scopeHasHoistedVar(scope, name)) return 'declaration';
  if (scope.statements.some((statement) => statementHasLexicalRuntimeName(statement, name))) {
    return 'declaration';
  }
  return sourceFileImportKind(scope, name);
}

function lexicalBindingAtNode(name: string, node: ts.Node): LexicalBindingKind | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    const binding = scopeBindingKind(current, name);
    if (binding) return binding;
    current = current.parent;
  }
  return undefined;
}

export function isNameShadowedAtNode(name: string, node: ts.Node): boolean {
  return lexicalBindingAtNode(name, node) === 'declaration';
}

export function isUnboundGlobalAtNode(name: string, node: ts.Node): boolean {
  return lexicalBindingAtNode(name, node) === undefined;
}

function facadeForCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  _boundaryBody: ts.Node,
  facades: Map<string, string>
): string | undefined {
  const reference = facadeReference(call.expression, facades);
  if (!reference) return undefined;
  if (isNameShadowedAtNode(reference.binding.text, call)) return undefined;
  if (reference.binding.getSourceFile() !== sourceFile) return undefined;
  return reference.facade;
}

function sourceMayEnterDeferredProtection(
  sourceFile: ts.SourceFile,
  facades: Map<string, string>
): boolean {
  let deferred = false;
  const visit = (node: ts.Node): void => {
    if (deferred) return;
    if (ts.isCallExpression(node)) {
      const facade = facadeForCall(node, sourceFile, sourceFile, facades);
      const context =
        facade === 'captureOpsException' || facade === 'captureBrowserException'
          ? node.arguments[1]
          : undefined;
      const input = context ? unwrapExpression(context) : undefined;
      if (
        input &&
        ts.isObjectLiteralExpression(input) &&
        objectDeferMode(input, 'deferUntilHandled') !== 'terminal'
      ) {
        deferred = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return deferred;
}

export function sourceHasProvisionalRuntimeCapture(sourceText: string, filePath: string): boolean {
  if (isExcludedPath(filePath)) return false;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  return sourceMayEnterDeferredProtection(sourceFile, importedFacades(sourceFile, filePath));
}

function validCaptureFacade(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  boundaryBody: ts.Node,
  aliases: Set<string>,
  facades: Map<string, string>
): string | undefined {
  const facade = facadeForCall(call, sourceFile, boundaryBody, facades);
  if (facade !== 'captureOpsException' && facade !== 'captureBrowserException') return undefined;
  if (call.arguments.length < 2 || !isAliasExpression(call.arguments[0], aliases)) return undefined;
  const context = unwrapExpression(call.arguments[1]);
  if (!ts.isObjectLiteralExpression(context)) return undefined;
  const required = ['code', 'source'].map((name) => effectiveObjectProperty(context, name));
  return required.every((property) => property.kind === 'known') ? facade : undefined;
}

function hasExactIgnoreComment(sourceFile: ts.SourceFile, start: number, end: number): boolean {
  if (end <= start) return false;
  const scanner = ts.createScanner(
    sourceFile.languageVersion,
    false,
    sourceFile.languageVariant,
    sourceFile.text
  );
  scanner.setTextPos(start);
  while (scanner.getTextPos() < end) {
    const token = scanner.scan();
    const tokenStart = scanner.getTokenPos();
    if (tokenStart >= end || token === ts.SyntaxKind.EndOfFileToken) break;
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
    const comment = scanner.getTokenText();
    if (/^\/\/\s*telemetry-ignore:\s*\S(?:.*\S)?\s*$/.test(comment)) return true;
  }
  return false;
}

type Protection = 'none' | 'provisional' | 'uncertain' | 'generic' | 'exact' | 'owned';

type FlowState = {
  aliases: Set<string>;
  protection: Protection;
  terminalizedOriginal?: boolean;
  waived?: boolean;
};

type AbruptCompletion = {
  kind: 'return' | 'throw' | 'break' | 'continue';
  state: FlowState;
  target?: ts.Node;
  exactOriginal?: boolean;
  waived?: boolean;
  ignoreTarget?: boolean;
};

type FlowOutcome = {
  states: FlowState[];
  abrupt: AbruptCompletion[];
  unsafe: boolean;
};

type FlowContext = {
  sourceFile: ts.SourceFile;
  boundaryBody: ts.Node;
  checker?: ts.TypeChecker;
  facades: Map<string, string>;
  foreignAliases: Set<string>;
  unknownFacadeEscape: boolean;
  taintedBindings: Set<ts.Symbol>;
};

type CaptureProtection = {
  state: FlowState;
  preEntryHazard: boolean;
  unsafe: boolean;
};

function copyState(state: FlowState): FlowState {
  return {
    aliases: new Set(state.aliases),
    protection: state.protection,
    terminalizedOriginal: state.terminalizedOriginal,
    waived: state.waived
  };
}

function copyCompletion(completion: AbruptCompletion, state = completion.state): AbruptCompletion {
  return { ...completion, state: copyState(state) };
}

function exactIgnoreBefore(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  return hasExactIgnoreComment(sourceFile, node.getFullStart(), node.getStart(sourceFile));
}

function exactIgnoreInsideEmptyBlock(block: ts.Block, sourceFile: ts.SourceFile): boolean {
  return (
    block.statements.length === 0 &&
    hasExactIgnoreComment(sourceFile, block.getStart(sourceFile) + 1, block.getEnd() - 1)
  );
}

function ignoreBelongsToBoundary(node: ts.Node, context: FlowContext): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && current !== context.boundaryBody) {
    if (ts.isCatchClause(current) || ts.isFunctionLike(current)) return false;
    current = current.parent;
  }
  return current === context.boundaryBody;
}

function isExactIgnoreTarget(statement: ts.Statement): boolean {
  return (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  );
}

function directCallExpression(expression: ts.Expression): ts.CallExpression | undefined {
  let current = unwrapExpression(expression);
  while (ts.isVoidExpression(current) || ts.isAwaitExpression(current)) {
    current = unwrapExpression(current.expression);
  }
  return ts.isCallExpression(current) ? current : undefined;
}

function isRuntimeCaptureMethod(call: ts.CallExpression, aliases: Set<string>): boolean {
  const callee = unwrapExpression(call.expression);
  const method = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isElementAccessExpression(callee)
      ? staticElementAccessName(callee.argumentExpression)
      : undefined;
  return (
    method === 'captureException' &&
    call.arguments.length >= 2 &&
    isAliasExpression(call.arguments[0], aliases)
  );
}

function forwardsOriginalToNext(expression: ts.Expression, state: FlowState): boolean {
  const call = directCallExpression(expression);
  if (!call) return false;
  const callee = unwrapExpression(call.expression);
  return (
    ts.isIdentifier(callee) &&
    callee.text === 'next' &&
    call.arguments.length > 0 &&
    isAliasExpression(call.arguments[0], state.aliases)
  );
}

function writtenBindingNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const collectTarget = (target: ts.Node): void => {
    if (ts.isIdentifier(target)) {
      names.add(target.text);
      return;
    }
    if (ts.isArrayLiteralExpression(target) || ts.isObjectLiteralExpression(target)) {
      ts.forEachChild(target, collectTarget);
    }
  };
  const visit = (child: ts.Node): void => {
    if (ts.isFunctionLike(child)) return;
    if (
      ts.isBinaryExpression(child) &&
      child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      child.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      collectTarget(child.left);
    } else if (
      (ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) &&
      (child.operator === ts.SyntaxKind.PlusPlusToken ||
        child.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      collectTarget(child.operand);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function invalidateWrittenAliases(state: FlowState, node: ts.Node): FlowState {
  const next = copyState(state);
  for (const name of writtenBindingNames(node)) next.aliases.delete(name);
  return next;
}

function containsHandlingEffect(node: ts.Node): boolean {
  let effectful = false;
  const visit = (child: ts.Node): void => {
    if (effectful || ts.isFunctionLike(child)) return;
    if (
      ts.isCallExpression(child) ||
      ts.isNewExpression(child) ||
      ts.isAwaitExpression(child) ||
      ts.isYieldExpression(child) ||
      ts.isDeleteExpression(child) ||
      (ts.isBinaryExpression(child) &&
        child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        child.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) &&
        (child.operator === ts.SyntaxKind.PlusPlusToken ||
          child.operator === ts.SyntaxKind.MinusMinusToken))
    ) {
      effectful = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return effectful;
}

function containsControlHandlingEffect(node: ts.Node): boolean {
  return containsHandlingEffect(node);
}

function containsPotentiallyThrowingEvaluation(node: ts.Node): boolean {
  let throwing = false;
  const visit = (child: ts.Node): void => {
    if (throwing || ts.isFunctionLike(child)) return;
    if (
      ts.isCallExpression(child) ||
      ts.isNewExpression(child) ||
      ts.isAwaitExpression(child) ||
      ts.isYieldExpression(child) ||
      ts.isDeleteExpression(child) ||
      ts.isTaggedTemplateExpression(child) ||
      ts.isTemplateExpression(child) ||
      ts.isPropertyAccessExpression(child) ||
      ts.isElementAccessExpression(child) ||
      ts.isSpreadAssignment(child) ||
      ts.isSpreadElement(child) ||
      (ts.isComputedPropertyName(child) && !isSafeComputedPropertyName(child)) ||
      ts.isClassDeclaration(child) ||
      ts.isClassExpression(child) ||
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child) ||
      (ts.isBinaryExpression(child) && !isNonCoerciveBinaryOperator(child.operatorToken.kind)) ||
      (ts.isPrefixUnaryExpression(child) && child.operator !== ts.SyntaxKind.ExclamationToken) ||
      ts.isPostfixUnaryExpression(child)
    ) {
      throwing = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return throwing;
}

function mayNeedTerminalProtection(protection: Protection): boolean {
  return protection === 'none' || protection === 'provisional' || protection === 'uncertain';
}

function stateNeedsEvidence(state: FlowState): boolean {
  return !state.waived && mayNeedTerminalProtection(state.protection);
}

function isTerminalProtection(protection: Protection): boolean {
  return protection === 'generic' || protection === 'exact' || protection === 'owned';
}

function captureProtection(
  expression: ts.Expression,
  state: FlowState,
  context: FlowContext
): CaptureProtection | undefined {
  const call = directCallExpression(expression);
  if (!call) return undefined;
  const knownFacade = facadeForCall(
    call,
    context.sourceFile,
    context.boundaryBody,
    context.facades
  );
  const facade = validCaptureFacade(
    call,
    context.sourceFile,
    context.boundaryBody,
    state.aliases,
    context.facades
  );
  const foreignFacade =
    !facade &&
    context.foreignAliases.size > 0 &&
    validCaptureFacade(
      call,
      context.sourceFile,
      context.boundaryBody,
      context.foreignAliases,
      context.facades
    );
  const runtimeCapture = isRuntimeCaptureMethod(call, state.aliases);
  const protectsForeignError = !!foreignFacade;
  const preEntryHazard = call.arguments.some(
    (argument) => !isSafelyEvaluatedFacadeExpression(argument)
  );
  const aliasesAfterArguments = invalidateWrittenAliases(state, call).aliases;
  const captureContext = call.arguments[1] ? unwrapExpression(call.arguments[1]) : undefined;
  if (!facade && !foreignFacade && !runtimeCapture && knownFacade === undefined) {
    return undefined;
  }
  if (!facade && !foreignFacade && !runtimeCapture) {
    return {
      state: {
        aliases: aliasesAfterArguments,
        protection: state.protection,
        terminalizedOriginal: state.terminalizedOriginal,
        waived: state.waived
      },
      preEntryHazard,
      unsafe: false
    };
  }
  if (protectsForeignError) {
    return {
      state: {
        aliases: aliasesAfterArguments,
        protection: state.protection,
        terminalizedOriginal: state.terminalizedOriginal,
        waived: state.waived
      },
      preEntryHazard,
      unsafe: false
    };
  }
  if (runtimeCapture) {
    return {
      state: {
        aliases: aliasesAfterArguments,
        protection: mayNeedTerminalProtection(state.protection) ? 'generic' : state.protection,
        terminalizedOriginal:
          state.terminalizedOriginal ||
          state.protection === 'none' ||
          state.protection === 'provisional',
        waived: state.waived
      },
      preEntryHazard: false,
      unsafe: false
    };
  }
  const deferMode = ts.isObjectLiteralExpression(captureContext)
    ? objectDeferMode(captureContext, 'deferUntilHandled')
    : 'uncertain';
  const protection =
    deferMode === 'provisional'
      ? state.protection === 'none'
        ? 'provisional'
        : state.protection
      : deferMode === 'uncertain'
        ? state.protection === 'none' || state.protection === 'provisional'
          ? 'uncertain'
          : state.protection
        : mayNeedTerminalProtection(state.protection)
          ? 'generic'
          : state.protection;
  return {
    state: {
      aliases: aliasesAfterArguments,
      protection,
      terminalizedOriginal:
        state.terminalizedOriginal ||
        ((state.protection === 'none' || state.protection === 'provisional') &&
          deferMode !== 'provisional'),
      waived: state.waived
    },
    preEntryHazard,
    unsafe: false
  };
}

function containsTerminalizingOriginalCapture(
  node: ts.Node,
  state: FlowState,
  context: FlowContext
): boolean {
  let terminalizes = false;
  const visit = (child: ts.Node): void => {
    if (terminalizes) return;
    if (ts.isCallExpression(child)) {
      const capture = captureProtection(child, state, context);
      if (capture?.state.terminalizedOriginal) {
        terminalizes = true;
        return;
      }
    }
    // Descend through closures, constructors, accessors, and class fields. When one of these
    // values is executed or escapes in the surrounding expression, JavaScript may synchronously
    // run the body before the original reaches its transparent rethrow.
    ts.forEachChild(child, visit);
  };
  visit(node);
  return terminalizes;
}

type TaintDefinition = {
  bindings: ts.Symbol[];
  value: ts.Node;
};

function symbolAtIdentifier(
  identifier: ts.Identifier,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  if (
    ts.isShorthandPropertyAssignment(identifier.parent) &&
    identifier.parent.name === identifier
  ) {
    return (
      checker.getShorthandAssignmentValueSymbol(identifier.parent) ??
      checker.getSymbolAtLocation(identifier)
    );
  }
  return checker.getSymbolAtLocation(identifier);
}

function bindingSymbols(name: ts.BindingName, checker: ts.TypeChecker): ts.Symbol[] {
  const symbols = new Set<ts.Symbol>();
  const visit = (binding: ts.BindingName): void => {
    if (ts.isIdentifier(binding)) {
      const symbol = symbolAtIdentifier(binding, checker);
      if (symbol) symbols.add(symbol);
      return;
    }
    for (const element of binding.elements) {
      if (!ts.isOmittedExpression(element)) visit(element.name);
    }
  };
  visit(name);
  return [...symbols];
}

function assignedBindingSymbols(target: ts.Node, checker: ts.TypeChecker): ts.Symbol[] {
  const symbols = new Set<ts.Symbol>();
  const addIdentifier = (identifier: ts.Identifier): void => {
    const symbol = symbolAtIdentifier(identifier, checker);
    if (symbol) symbols.add(symbol);
  };
  const visit = (node: ts.Node): void => {
    const unwrapped = ts.isExpression(node) ? unwrapExpression(node) : node;
    if (ts.isIdentifier(unwrapped)) {
      addIdentifier(unwrapped);
      return;
    }
    if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
      let receiver = unwrapExpression(unwrapped.expression);
      while (ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver)) {
        receiver = unwrapExpression(receiver.expression);
      }
      if (ts.isIdentifier(receiver)) addIdentifier(receiver);
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) {
        if (ts.isSpreadElement(element)) visit(element.expression);
        else if (!ts.isOmittedExpression(element)) visit(element);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
      for (const property of unwrapped.properties) {
        if (ts.isShorthandPropertyAssignment(property)) visit(property.name);
        else if (ts.isPropertyAssignment(property)) visit(property.initializer);
        else if (ts.isSpreadAssignment(property)) visit(property.expression);
      }
      return;
    }
    if (
      ts.isBinaryExpression(unwrapped) &&
      unwrapped.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      unwrapped.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      visit(unwrapped.left);
    }
  };
  visit(target);
  return [...symbols];
}

function taintDefinitions(sourceFile: ts.SourceFile, checker: ts.TypeChecker): TaintDefinition[] {
  const definitions: TaintDefinition[] = [];
  const add = (bindings: ts.Symbol[], value: ts.Node): void => {
    if (bindings.length > 0) definitions.push({ bindings, value });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      add(bindingSymbols(node.name, checker), node.initializer);
    } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const symbol = symbolAtIdentifier(node.name, checker);
      if (symbol) add([symbol], node);
    } else if (ts.isClassDeclaration(node) && node.name) {
      const symbol = symbolAtIdentifier(node.name, checker);
      if (symbol) add([symbol], node);
    } else if (ts.isEnumDeclaration(node)) {
      const symbol = symbolAtIdentifier(node.name, checker);
      if (symbol) add([symbol], node);
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      const symbol = symbolAtIdentifier(node.name, checker);
      if (symbol) add([symbol], node.body);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      add(assignedBindingSymbols(node.left, checker), node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return definitions;
}

function runtimeFacadeBindingSymbols(
  sourceFile: ts.SourceFile,
  facades: Map<string, string>,
  checker: ts.TypeChecker
): Set<ts.Symbol> {
  const symbols = new Set<ts.Symbol>();
  const namespaceBindings = new Set<string>();
  for (const name of facades.keys()) {
    const separator = name.indexOf('.');
    if (separator > 0) namespaceBindings.add(name.slice(0, separator));
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
    const bindings = clause.namedBindings;
    if (ts.isNamespaceImport(bindings)) {
      if (!namespaceBindings.has(bindings.name.text)) continue;
      const symbol = symbolAtIdentifier(bindings.name, checker);
      if (symbol) symbols.add(symbol);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly || !facades.has(element.name.text)) continue;
      const symbol = symbolAtIdentifier(element.name, checker);
      if (symbol) symbols.add(symbol);
    }
  }
  return symbols;
}

function isRuntimeIdentifierReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }
  if (
    ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === identifier) ||
    (ts.isBindingElement(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    (ts.isImportSpecifier(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    ts.isNamespaceImport(parent) ||
    (ts.isImportClause(parent) && parent.name === identifier) ||
    (ts.isLabeledStatement(parent) && parent.label === identifier) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === identifier)
  ) {
    return false;
  }
  if (
    (ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }
  return true;
}

function containsTaintedBindingReference(
  node: ts.Node,
  taintedBindings: Set<ts.Symbol>,
  checker: ts.TypeChecker
): boolean {
  if (taintedBindings.size === 0) return false;
  let referenced = false;
  const visit = (child: ts.Node): void => {
    if (referenced) return;
    if (
      ts.isTypeNode(child) ||
      ts.isInterfaceDeclaration(child) ||
      ts.isTypeAliasDeclaration(child)
    ) {
      return;
    }
    if (ts.isIdentifier(child) && isRuntimeIdentifierReference(child)) {
      const symbol = symbolAtIdentifier(child, checker);
      if (symbol && taintedBindings.has(symbol)) {
        referenced = true;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return referenced;
}

function referencedRuntimeBindings(node: ts.Node, checker: ts.TypeChecker): Set<ts.Symbol> {
  const bindings = new Set<ts.Symbol>();
  const visit = (child: ts.Node): void => {
    if (
      ts.isTypeNode(child) ||
      ts.isInterfaceDeclaration(child) ||
      ts.isTypeAliasDeclaration(child)
    ) {
      return;
    }
    if (ts.isIdentifier(child) && isRuntimeIdentifierReference(child)) {
      const symbol = symbolAtIdentifier(child, checker);
      if (symbol) bindings.add(symbol);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return bindings;
}

function taintPropagationGraph(
  definitions: TaintDefinition[],
  checker: ts.TypeChecker
): Map<ts.Symbol, Set<ts.Symbol>> {
  const graph = new Map<ts.Symbol, Set<ts.Symbol>>();
  for (const definition of definitions) {
    for (const referenced of referencedRuntimeBindings(definition.value, checker)) {
      const dependents = graph.get(referenced) ?? new Set<ts.Symbol>();
      for (const binding of definition.bindings) dependents.add(binding);
      graph.set(referenced, dependents);
    }
  }
  return graph;
}

function propagateTaint(
  seeds: Iterable<ts.Symbol>,
  graph: Map<ts.Symbol, Set<ts.Symbol>>
): Set<ts.Symbol> {
  const tainted = new Set(seeds);
  const pending = [...tainted];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const dependent of graph.get(current) ?? []) {
      if (tainted.has(dependent)) continue;
      tainted.add(dependent);
      pending.push(dependent);
    }
  }
  return tainted;
}

function terminalizingTaintedBindings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  facadeBindings: Set<ts.Symbol>
): Set<ts.Symbol> {
  const definitions = taintDefinitions(sourceFile, checker);
  const seeds = new Set(facadeBindings);
  for (const definition of definitions) {
    if (!containsDirectEval(definition.value)) continue;
    for (const binding of definition.bindings) seeds.add(binding);
  }
  return propagateTaint(seeds, taintPropagationGraph(definitions, checker));
}

type ReturnCapabilityDefinition = {
  bindings: ts.Symbol[];
  returns: ts.Expression[];
};

function functionReturnedExpressions(functionLike: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!('body' in functionLike) || !functionLike.body) return [];
  if (!ts.isBlock(functionLike.body)) return [functionLike.body];
  const returned: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionLike.body && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
    if (ts.isReturnStatement(node) && node.expression) {
      returned.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body);
  return returned;
}

function returnCapabilityDefinitions(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): ReturnCapabilityDefinition[] {
  const definitions: ReturnCapabilityDefinition[] = [];
  const add = (bindings: ts.Symbol[], functionLike: ts.FunctionLikeDeclaration): void => {
    const returns = functionReturnedExpressions(functionLike);
    if (bindings.length > 0 && returns.length > 0) definitions.push({ bindings, returns });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const symbol = symbolAtIdentifier(node.name, checker);
      if (symbol) add([symbol], node);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(unwrapExpression(node.initializer)) ||
        ts.isFunctionExpression(unwrapExpression(node.initializer)))
    ) {
      add(
        bindingSymbols(node.name, checker),
        unwrapExpression(node.initializer) as ts.ArrowFunction | ts.FunctionExpression
      );
    } else if (
      ts.isPropertyAssignment(node) &&
      (ts.isArrowFunction(unwrapExpression(node.initializer)) ||
        ts.isFunctionExpression(unwrapExpression(node.initializer)))
    ) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        add(
          [symbol],
          unwrapExpression(node.initializer) as ts.ArrowFunction | ts.FunctionExpression
        );
      }
    } else if (
      ts.isPropertyDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(unwrapExpression(node.initializer)) ||
        ts.isFunctionExpression(unwrapExpression(node.initializer)))
    ) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        add(
          [symbol],
          unwrapExpression(node.initializer) as ts.ArrowFunction | ts.FunctionExpression
        );
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      (ts.isArrowFunction(unwrapExpression(node.right)) ||
        ts.isFunctionExpression(unwrapExpression(node.right)))
    ) {
      const target = unwrapExpression(node.left);
      const targetSymbol = ts.isPropertyAccessExpression(target)
        ? checker.getSymbolAtLocation(target.name)
        : ts.isElementAccessExpression(target) && target.argumentExpression
          ? checker.getSymbolAtLocation(target.argumentExpression)
          : undefined;
      add(
        targetSymbol ? [targetSymbol] : assignedBindingSymbols(node.left, checker),
        unwrapExpression(node.right) as ts.ArrowFunction | ts.FunctionExpression
      );
    } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) add([symbol], node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return definitions;
}

function callTargetSymbol(
  expression: ts.Expression,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) return symbolAtIdentifier(callee, checker);
  if (ts.isPropertyAccessExpression(callee)) return checker.getSymbolAtLocation(callee.name);
  if (ts.isElementAccessExpression(callee) && callee.argumentExpression) {
    return checker.getSymbolAtLocation(callee.argumentExpression);
  }
  return undefined;
}

function symbolSetContains(symbols: Set<ts.Symbol>, candidate: ts.Symbol | undefined): boolean {
  if (!candidate) return false;
  if (symbols.has(candidate)) return true;
  const declarations = candidate.declarations;
  return !!declarations?.some((declaration) =>
    [...symbols].some((symbol) => symbol.declarations?.includes(declaration))
  );
}

function expressionMayResolveToFactory(
  expression: ts.Expression,
  factoryBindings: Set<ts.Symbol>,
  checker: ts.TypeChecker
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isConditionalExpression(unwrapped)) {
    return (
      expressionMayResolveToFactory(unwrapped.whenTrue, factoryBindings, checker) ||
      expressionMayResolveToFactory(unwrapped.whenFalse, factoryBindings, checker)
    );
  }
  if (ts.isBinaryExpression(unwrapped)) {
    if (unwrapped.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return expressionMayResolveToFactory(unwrapped.right, factoryBindings, checker);
    }
    if (
      unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return (
        expressionMayResolveToFactory(unwrapped.left, factoryBindings, checker) ||
        expressionMayResolveToFactory(unwrapped.right, factoryBindings, checker)
      );
    }
  }
  if (ts.isCallExpression(unwrapped)) {
    const callee = unwrapExpression(unwrapped.expression);
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const member = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : staticElementAccessName(callee.argumentExpression);
      if (
        member === 'bind' &&
        expressionMayResolveToFactory(callee.expression, factoryBindings, checker)
      ) {
        return true;
      }
    }
    return false;
  }
  const target = callTargetSymbol(unwrapped, checker);
  if (symbolSetContains(factoryBindings, target)) return true;
  return [...referencedRuntimeBindings(unwrapped, checker)].some((symbol) =>
    symbolSetContains(factoryBindings, symbol)
  );
}

function invocationYieldsEscapableCapability(
  invocation: ts.CallExpression | ts.NewExpression,
  capabilityBindings: Set<ts.Symbol>,
  factoryBindings: Set<ts.Symbol>,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  facades: Map<string, string>,
  definitions: TaintDefinition[],
  flowGraph: Map<ts.Symbol, Set<ts.Symbol>>,
  forwardedCache: Map<ts.SignatureDeclaration, Set<ts.Symbol>>
): boolean {
  const callee = unwrapExpression(invocation.expression);
  if (ts.isNewExpression(invocation)) {
    return containsTaintedBindingReference(callee, capabilityBindings, checker);
  }
  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
    const member = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : staticElementAccessName(callee.argumentExpression);
    if (
      member === 'bind' &&
      containsTaintedBindingReference(callee.expression, capabilityBindings, checker)
    ) {
      return true;
    }
    if (
      (member === 'call' || member === 'apply') &&
      expressionMayResolveToFactory(callee.expression, factoryBindings, checker)
    ) {
      return true;
    }
  }
  if (expressionMayResolveToFactory(callee, factoryBindings, checker)) return true;
  if (
    ts.isCallExpression(callee) &&
    invocationYieldsEscapableCapability(
      callee,
      capabilityBindings,
      factoryBindings,
      checker,
      sourceFile,
      facades,
      definitions,
      flowGraph,
      forwardedCache
    )
  ) {
    return true;
  }
  if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
    return functionReturnedExpressions(callee).some((expression) =>
      expressionYieldsEscapableCapability(
        expression,
        capabilityBindings,
        factoryBindings,
        checker,
        sourceFile,
        facades,
        definitions,
        flowGraph,
        forwardedCache
      )
    );
  }
  return false;
}

function expressionYieldsEscapableCapability(
  expression: ts.Expression,
  capabilityBindings: Set<ts.Symbol>,
  factoryBindings: Set<ts.Symbol>,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  facades: Map<string, string>,
  definitions: TaintDefinition[],
  flowGraph: Map<ts.Symbol, Set<ts.Symbol>>,
  forwardedCache: Map<ts.SignatureDeclaration, Set<ts.Symbol>>
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isAwaitExpression(unwrapped)) {
    return expressionYieldsEscapableCapability(
      unwrapped.expression,
      capabilityBindings,
      factoryBindings,
      checker,
      sourceFile,
      facades,
      definitions,
      flowGraph,
      forwardedCache
    );
  }
  if (ts.isCallExpression(unwrapped) || ts.isNewExpression(unwrapped)) {
    return invocationYieldsEscapableCapability(
      unwrapped,
      capabilityBindings,
      factoryBindings,
      checker,
      sourceFile,
      facades,
      definitions,
      flowGraph,
      forwardedCache
    );
  }
  if (ts.isConditionalExpression(unwrapped)) {
    return (
      expressionYieldsEscapableCapability(
        unwrapped.whenTrue,
        capabilityBindings,
        factoryBindings,
        checker,
        sourceFile,
        facades,
        definitions,
        flowGraph,
        forwardedCache
      ) ||
      expressionYieldsEscapableCapability(
        unwrapped.whenFalse,
        capabilityBindings,
        factoryBindings,
        checker,
        sourceFile,
        facades,
        definitions,
        flowGraph,
        forwardedCache
      )
    );
  }
  if (
    ts.isBinaryExpression(unwrapped) &&
    (unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return (
      expressionYieldsEscapableCapability(
        unwrapped.left,
        capabilityBindings,
        factoryBindings,
        checker,
        sourceFile,
        facades,
        definitions,
        flowGraph,
        forwardedCache
      ) ||
      expressionYieldsEscapableCapability(
        unwrapped.right,
        capabilityBindings,
        factoryBindings,
        checker,
        sourceFile,
        facades,
        definitions,
        flowGraph,
        forwardedCache
      )
    );
  }
  return definitionCarriesEscapableCapability(
    unwrapped,
    capabilityBindings,
    factoryBindings,
    checker,
    sourceFile,
    facades,
    definitions,
    flowGraph,
    forwardedCache
  );
}

function definitionCarriesEscapableCapability(
  value: ts.Node,
  capabilityBindings: Set<ts.Symbol>,
  factoryBindings: Set<ts.Symbol>,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  facades: Map<string, string>,
  definitions: TaintDefinition[],
  flowGraph: Map<ts.Symbol, Set<ts.Symbol>>,
  forwardedCache: Map<ts.SignatureDeclaration, Set<ts.Symbol>>
): boolean {
  if (containsDirectEval(value)) return true;
  const forwardedBindings = (functionLike: ts.SignatureDeclaration): Set<ts.Symbol> => {
    const cached = forwardedCache.get(functionLike);
    if (cached) return cached;
    const forwarded = new Set<ts.Symbol>();
    let scope: ts.Node | undefined = functionLike;
    while (scope) {
      if (ts.isFunctionLike(scope)) {
        for (const parameter of scope.parameters) {
          for (const symbol of bindingSymbols(parameter.name, checker)) forwarded.add(symbol);
        }
      }
      scope = scope.parent;
    }
    const propagated = propagateTaint(forwarded, flowGraph);
    forwardedCache.set(functionLike, propagated);
    return propagated;
  };
  let carries = false;
  const visit = (node: ts.Node, forwarded: Set<ts.Symbol>): void => {
    if (carries) return;
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      return;
    }
    if (ts.isVoidExpression(node)) {
      const operand = unwrapExpression(node.expression);
      if (ts.isIdentifier(operand)) {
        const symbol = symbolAtIdentifier(operand, checker);
        if (symbol && capabilityBindings.has(symbol)) return;
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (
        invocationYieldsEscapableCapability(
          node,
          capabilityBindings,
          factoryBindings,
          checker,
          sourceFile,
          facades,
          definitions,
          flowGraph,
          forwardedCache
        )
      ) {
        carries = true;
        return;
      }
      const directFacade = ts.isCallExpression(node)
        ? facadeForCall(node, sourceFile, sourceFile, facades)
        : undefined;
      const forwardedFacadeInputs = (() => {
        if (!directFacade || !ts.isCallExpression(node)) return [];
        return node.arguments[0] ? [node.arguments[0]] : [...node.arguments];
      })();
      const directFacadeCanTerminalize = !!directFacade;
      const invokesCapability =
        directFacadeCanTerminalize ||
        (!directFacade &&
          containsTaintedBindingReference(node.expression, capabilityBindings, checker));
      if (
        forwarded.size > 0 &&
        invokesCapability &&
        (directFacade ? forwardedFacadeInputs : (node.arguments ?? [])).some((argument) =>
          containsTaintedBindingReference(argument, forwarded, checker)
        )
      ) {
        carries = true;
        return;
      }
      // Invoking a terminalizing helper does not make its ordinary return value another facade.
      // Arguments are escape edges in their own right and are handled by the source-level scan.
      for (const argument of node.arguments ?? []) {
        visit(argument, forwarded);
      }
      return;
    }
    if (ts.isIdentifier(node) && isRuntimeIdentifierReference(node)) {
      const symbol = symbolAtIdentifier(node, checker);
      if (symbol && capabilityBindings.has(symbol)) {
        carries = true;
        return;
      }
    }
    if (ts.isFunctionLike(node)) {
      const nextForwarded = forwardedBindings(node);
      if ('body' in node && node.body) visit(node.body, nextForwarded);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, forwarded));
  };
  visit(value, new Set());
  return carries;
}

function definitionCarriesFactoryIdentity(
  value: ts.Node,
  factoryBindings: Set<ts.Symbol>,
  checker: ts.TypeChecker
): boolean {
  let carries = false;
  const visit = (node: ts.Node): void => {
    if (carries) return;
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const member = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : staticElementAccessName(callee.argumentExpression);
        if (
          member === 'bind' &&
          expressionMayResolveToFactory(callee.expression, factoryBindings, checker)
        ) {
          carries = true;
        }
      }
      return;
    }
    if (
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isFunctionLike(node) ||
      ts.isClassLike(node) ||
      ts.isNewExpression(node)
    ) {
      return;
    }
    if (ts.isVoidExpression(node)) {
      const operand = unwrapExpression(node.expression);
      if (ts.isIdentifier(operand)) {
        const symbol = symbolAtIdentifier(operand, checker);
        if (symbolSetContains(factoryBindings, symbol)) return;
      }
    }
    if (ts.isIdentifier(node) && isRuntimeIdentifierReference(node)) {
      const symbol = symbolAtIdentifier(node, checker);
      if (symbolSetContains(factoryBindings, symbol)) {
        carries = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(value);
  return carries;
}

type EscapableCapabilityAnalysis = {
  bindings: Set<ts.Symbol>;
  definitions: TaintDefinition[];
  factoryBindings: Set<ts.Symbol>;
  flowGraph: Map<ts.Symbol, Set<ts.Symbol>>;
  forwardedCache: Map<ts.SignatureDeclaration, Set<ts.Symbol>>;
};

function escapableCapabilityBindings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  facadeBindings: Set<ts.Symbol>,
  facades: Map<string, string>
): EscapableCapabilityAnalysis {
  const capabilities = new Set(facadeBindings);
  const factories = new Set<ts.Symbol>();
  const definitions = taintDefinitions(sourceFile, checker);
  const returnDefinitions = returnCapabilityDefinitions(sourceFile, checker);
  const flowGraph = taintPropagationGraph(definitions, checker);
  const forwardedCache = new Map<ts.SignatureDeclaration, Set<ts.Symbol>>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      if (definition.bindings.every((binding) => capabilities.has(binding))) continue;
      if (
        !definitionCarriesEscapableCapability(
          definition.value,
          capabilities,
          factories,
          checker,
          sourceFile,
          facades,
          definitions,
          flowGraph,
          forwardedCache
        )
      ) {
        continue;
      }
      for (const binding of definition.bindings) {
        if (capabilities.has(binding)) continue;
        capabilities.add(binding);
        changed = true;
      }
    }
    for (const definition of returnDefinitions) {
      if (definition.bindings.every((binding) => factories.has(binding))) continue;
      if (
        !definition.returns.some((expression) =>
          expressionYieldsEscapableCapability(
            expression,
            capabilities,
            factories,
            checker,
            sourceFile,
            facades,
            definitions,
            flowGraph,
            forwardedCache
          )
        )
      ) {
        continue;
      }
      for (const binding of definition.bindings) {
        if (factories.has(binding)) continue;
        factories.add(binding);
        changed = true;
      }
    }
    for (const definition of definitions) {
      if (definition.bindings.every((binding) => factories.has(binding))) continue;
      if (!definitionCarriesFactoryIdentity(definition.value, factories, checker)) continue;
      for (const binding of definition.bindings) {
        if (factories.has(binding)) continue;
        factories.add(binding);
        changed = true;
      }
    }
  }
  return {
    bindings: capabilities,
    definitions,
    factoryBindings: factories,
    flowGraph,
    forwardedCache
  };
}

function isDirectInlinePromiseCatchHandler(
  node: ts.CallExpression | ts.NewExpression,
  argument: ts.Expression,
  index: number
): boolean {
  if (!ts.isCallExpression(node) || index !== 0 || !promiseCatchBoundary(node)) return false;
  const handler = unwrapExpression(argument);
  return (
    ts.isArrowFunction(handler) || (ts.isFunctionExpression(handler) && !handler.asteriskToken)
  );
}

function sourceHasUnknownFacadeEscape(
  sourceFile: ts.SourceFile,
  facades: Map<string, string>,
  capabilityAnalysis: EscapableCapabilityAnalysis,
  checker: ts.TypeChecker
): boolean {
  const { bindings, definitions, factoryBindings, flowGraph, forwardedCache } = capabilityAnalysis;
  let escaped = false;
  const visit = (node: ts.Node): void => {
    if (escaped) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const knownFacade =
        ts.isCallExpression(node) &&
        facadeForCall(node, sourceFile, sourceFile, facades) !== undefined;
      if (
        !knownFacade &&
        (node.arguments ?? []).some(
          (argument, index) =>
            !isDirectInlinePromiseCatchHandler(node, argument, index) &&
            definitionCarriesEscapableCapability(
              argument,
              bindings,
              factoryBindings,
              checker,
              sourceFile,
              facades,
              definitions,
              flowGraph,
              forwardedCache
            )
        )
      ) {
        escaped = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return escaped;
}

function referencesTerminalizingDeferredDefinition(
  expression: ts.Expression,
  context: FlowContext
): boolean {
  if (!context.checker) return false;
  const unwrapped = unwrapExpression(expression);
  if (ts.isVoidExpression(unwrapped)) {
    const candidate = unwrapExpression(unwrapped.expression);
    const symbol = ts.isIdentifier(candidate)
      ? symbolAtIdentifier(candidate, context.checker)
      : undefined;
    if (symbol && context.taintedBindings.has(symbol)) {
      // Reading a local capability solely through `void` neither invokes nor exposes it.
      return false;
    }
  }
  return containsTaintedBindingReference(expression, context.taintedBindings, context.checker);
}

function containsExecutableOrEscapingFacadeReference(
  expression: ts.Expression,
  context: FlowContext
): boolean {
  const unwrapped = unwrapExpression(expression);
  let inertFacade: ts.Identifier | undefined;
  if (ts.isVoidExpression(unwrapped)) {
    const candidate = unwrapExpression(unwrapped.expression);
    if (ts.isIdentifier(candidate)) inertFacade = candidate;
  }
  if (
    inertFacade &&
    context.facades.has(inertFacade.text) &&
    !isNameShadowedAtNode(inertFacade.text, inertFacade)
  ) {
    // Reading a local function value solely through `void` neither invokes nor exposes it.
    return false;
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isExpression(node)) {
      const reference = facadeReference(node, context.facades);
      if (
        reference &&
        !isNameShadowedAtNode(reference.binding.text, reference.binding) &&
        isRuntimeIdentifierReference(reference.binding)
      ) {
        found = true;
        return;
      }
    }
    if (
      ts.isIdentifier(node) &&
      context.facades.has(node.text) &&
      !isNameShadowedAtNode(node.text, node) &&
      isRuntimeIdentifierReference(node)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function containsDirectEval(expression: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (
        ts.isIdentifier(callee) &&
        callee.text === 'eval' &&
        isUnboundGlobalAtNode('eval', callee)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function escapedFacadeMayRun(expression: ts.Expression, context: FlowContext): boolean {
  return context.unknownFacadeEscape && containsPotentiallyThrowingEvaluation(expression);
}

function nestedCaptureMayTerminalizeOriginal(
  expression: ts.Expression,
  state: FlowState,
  context: FlowContext
): boolean {
  if (state.protection !== 'provisional' && state.protection !== 'uncertain') return false;
  const unwrapped = unwrapExpression(expression);
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    // Merely creating a local closure does not run it. A later invocation or escape is detected
    // through its declared name below.
    return false;
  }
  return (
    containsTerminalizingOriginalCapture(expression, state, context) ||
    referencesTerminalizingDeferredDefinition(expression, context) ||
    containsExecutableOrEscapingFacadeReference(expression, context) ||
    escapedFacadeMayRun(expression, context) ||
    containsDirectEval(expression)
  );
}

function analyzeExpression(
  expression: ts.Expression,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  const capture = captureProtection(expression, state, context);
  if (capture) {
    return {
      states: [capture.state],
      abrupt: capture.preEntryHazard
        ? [{ kind: 'throw', state: copyState(state), exactOriginal: false }]
        : [],
      unsafe:
        !state.waived && (capture.unsafe || (capture.preEntryHazard && state.protection === 'none'))
    };
  }
  const next = invalidateWrittenAliases(state, expression);
  const nestedTerminalizes = nestedCaptureMayTerminalizeOriginal(expression, state, context);
  if (nestedTerminalizes) {
    next.terminalizedOriginal = true;
  }
  if (forwardsOriginalToNext(expression, state)) {
    return {
      states: [],
      abrupt: [{ kind: 'throw', state: copyState(state), exactOriginal: true }],
      unsafe: false
    };
  }
  const simpleExpression = unwrapExpression(expression);
  const preservesTerminalizedOriginal =
    nestedTerminalizes ||
    ts.isIdentifier(simpleExpression) ||
    ts.isStringLiteral(simpleExpression) ||
    ts.isNumericLiteral(simpleExpression) ||
    ts.isNoSubstitutionTemplateLiteral(simpleExpression) ||
    simpleExpression.kind === ts.SyntaxKind.TrueKeyword ||
    simpleExpression.kind === ts.SyntaxKind.FalseKeyword ||
    simpleExpression.kind === ts.SyntaxKind.NullKeyword;
  if (
    next.terminalizedOriginal &&
    !isAliasExpression(expression, state.aliases) &&
    !preservesTerminalizedOriginal
  ) {
    next.terminalizedOriginal = undefined;
  }
  const potentiallyThrowing = containsPotentiallyThrowingEvaluation(expression);
  return {
    states: [next],
    abrupt: potentiallyThrowing
      ? [{ kind: 'throw', state: copyState(state), exactOriginal: false }]
      : [],
    unsafe:
      !state.waived && state.protection === 'none' && containsControlHandlingEffect(expression)
  };
}

function analyzeExpressionsForStates(
  expression: ts.Expression,
  states: FlowState[],
  context: FlowContext
): FlowOutcome {
  const nextStates: FlowState[] = [];
  const abrupt: AbruptCompletion[] = [];
  let unsafe = false;
  for (const state of states) {
    const outcome = analyzeExpression(expression, state, context);
    nextStates.push(...outcome.states);
    abrupt.push(...outcome.abrupt);
    unsafe ||= outcome.unsafe;
  }
  return { states: nextStates, abrupt, unsafe };
}

function analyzeBindingNameEvaluation(
  name: ts.BindingName,
  initialStates: FlowState[],
  context: FlowContext
): FlowOutcome {
  let states = initialStates.map(copyState);
  const abrupt: AbruptCompletion[] = [];
  let unsafe = false;
  if (ts.isIdentifier(name)) return { states, abrupt, unsafe };
  abrupt.push(
    ...states.map(
      (state): AbruptCompletion => ({
        kind: 'throw',
        state: copyState(state),
        exactOriginal: false
      })
    )
  );
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    if (element.propertyName && ts.isComputedPropertyName(element.propertyName)) {
      const computed = analyzeExpressionsForStates(
        element.propertyName.expression,
        states,
        context
      );
      states = computed.states;
      abrupt.push(...computed.abrupt);
      unsafe ||= computed.unsafe;
    }
    if (element.initializer) {
      const skipped = states.map(copyState);
      const initialized = analyzeExpressionsForStates(element.initializer, states, context);
      states = [...skipped, ...initialized.states];
      abrupt.push(...initialized.abrupt);
      unsafe ||= initialized.unsafe;
    }
    const nested = analyzeBindingNameEvaluation(element.name, states, context);
    states = nested.states;
    abrupt.push(...nested.abrupt);
    unsafe ||= nested.unsafe;
  }
  return { states, abrupt, unsafe };
}

function analyzeVariableDeclarationList(
  declarationList: ts.VariableDeclarationList,
  initialStates: FlowState[],
  context: FlowContext
): FlowOutcome {
  let states = initialStates.map(copyState);
  const abrupt: AbruptCompletion[] = [];
  let unsafe = false;
  const immutable = (declarationList.flags & ts.NodeFlags.Const) !== 0;
  const usingDeclaration = isUsingDeclarationList(declarationList);
  for (const declaration of declarationList.declarations) {
    const declarationStates: FlowState[] = [];
    for (const state of states) {
      const initialized = declaration.initializer
        ? analyzeExpression(declaration.initializer, state, context)
        : { states: [copyState(state)], abrupt: [], unsafe: false };
      abrupt.push(...initialized.abrupt);
      if (usingDeclaration) {
        abrupt.push(
          ...initialized.states.map(
            (next): AbruptCompletion => ({
              kind: 'throw',
              state: copyState(next),
              exactOriginal: false
            })
          )
        );
      }
      unsafe ||= initialized.unsafe;
      const binding = analyzeBindingNameEvaluation(declaration.name, initialized.states, context);
      abrupt.push(...binding.abrupt);
      unsafe ||= binding.unsafe;
      const names = new Set<string>();
      collectBindingNames(declaration.name, names);
      for (const next of binding.states) {
        for (const name of names) next.aliases.delete(name);
        if (
          immutable &&
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          isAliasExpression(declaration.initializer, state.aliases)
        ) {
          next.aliases.add(declaration.name.text);
        }
        declarationStates.push(next);
      }
    }
    states = declarationStates;
  }
  return { states, abrupt, unsafe };
}

function analyzeStatements(
  statements: readonly ts.Statement[],
  initialStates: FlowState[],
  context: FlowContext
): FlowOutcome {
  let states = initialStates.map(copyState);
  const abrupt: AbruptCompletion[] = [];
  let unsafe = false;
  for (const statement of statements) {
    const nextStates: FlowState[] = [];
    for (const state of states) {
      const outcome = analyzeStatement(statement, state, context);
      const waived =
        isExactIgnoreTarget(statement) &&
        exactIgnoreBefore(statement, context.sourceFile) &&
        ignoreBelongsToBoundary(statement, context);
      nextStates.push(...outcome.states);
      abrupt.push(
        ...outcome.abrupt.map((completion) =>
          waived && completion.ignoreTarget
            ? { ...copyCompletion(completion), waived: true }
            : completion
        )
      );
      unsafe ||= outcome.unsafe;
    }
    states = nextStates;
  }
  return { states, abrupt, unsafe };
}

function lexicalDeclarationNames(statements: readonly ts.Statement[]): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    if (
      ts.isVariableStatement(statement) &&
      isBlockScopedDeclarationList(statement.declarationList)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.getText());
    }
  }
  return names;
}

function restoreScopedAliases(exit: FlowState, outer: FlowState, names: Set<string>): FlowState {
  const restored = copyState(exit);
  for (const name of names) {
    if (outer.aliases.has(name)) restored.aliases.add(name);
    else restored.aliases.delete(name);
  }
  return restored;
}

function analyzeBlock(block: ts.Block, state: FlowState, context: FlowContext): FlowOutcome {
  if (exactIgnoreInsideEmptyBlock(block, context.sourceFile)) {
    const isIfBranch =
      ts.isIfStatement(block.parent) &&
      (block.parent.thenStatement === block || block.parent.elseStatement === block);
    if (isIfBranch && ignoreBelongsToBoundary(block, context)) {
      const owned = copyState(state);
      owned.protection = 'owned';
      return { states: [owned], abrupt: [], unsafe: false };
    }
    return { states: [copyState(state)], abrupt: [], unsafe: false };
  }
  const scopedNames = lexicalDeclarationNames(block.statements);
  const hasUsingDeclaration = block.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) && isUsingDeclarationList(statement.declarationList)
  );
  const scopedEntry = copyState(state);
  for (const name of scopedNames) scopedEntry.aliases.delete(name);
  const outcome = analyzeStatements(block.statements, [scopedEntry], context);
  const restore = (exit: FlowState): FlowState => restoreScopedAliases(exit, state, scopedNames);
  return {
    states: outcome.states.map(restore),
    abrupt: [
      ...outcome.abrupt,
      ...(hasUsingDeclaration
        ? [...outcome.states, ...outcome.abrupt.map((completion) => completion.state)].map(
            (exit): AbruptCompletion => ({
              kind: 'throw',
              state: copyState(exit),
              exactOriginal: false
            })
          )
        : [])
    ].map((completion) => ({
      ...completion,
      state: restore(completion.state)
    })),
    unsafe: outcome.unsafe
  };
}

function isIterationStatement(node: ts.Node): node is ts.IterationStatement {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

function breakTarget(statement: ts.BreakStatement): ts.Node | undefined {
  let current: ts.Node | undefined = statement.parent;
  if (statement.label) {
    while (current) {
      if (ts.isLabeledStatement(current) && current.label.text === statement.label.text) {
        return current;
      }
      current = current.parent;
    }
    return undefined;
  }
  while (current) {
    if (ts.isSwitchStatement(current) || isIterationStatement(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function continueTarget(statement: ts.ContinueStatement): ts.Node | undefined {
  let current: ts.Node | undefined = statement.parent;
  if (statement.label) {
    while (current) {
      if (ts.isLabeledStatement(current) && current.label.text === statement.label.text) {
        let target: ts.Statement = current.statement;
        while (ts.isLabeledStatement(target)) target = target.statement;
        return isIterationStatement(target) ? target : current;
      }
      current = current.parent;
    }
    return undefined;
  }
  while (current) {
    if (isIterationStatement(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function analyzeSwitchClauses(
  statement: ts.SwitchStatement,
  initialStates: FlowState[],
  context: FlowContext
): FlowOutcome {
  const clauses = statement.caseBlock.clauses;
  const states: FlowState[] = [];
  const abrupt: AbruptCompletion[] = [];
  const entryStates: FlowState[][] = [];
  let unmatched = initialStates.map(copyState);
  let unsafe = false;
  let defaultIndex = -1;
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    if (ts.isDefaultClause(clause)) {
      defaultIndex = index;
      continue;
    }
    const selector = analyzeExpressionsForStates(clause.expression, unmatched, context);
    unsafe ||= selector.unsafe;
    abrupt.push(...selector.abrupt);
    unmatched = selector.states;
    entryStates[index] = unmatched.map(copyState);
  }
  if (defaultIndex >= 0) entryStates[defaultIndex] = unmatched.map(copyState);
  for (let start = 0; start < clauses.length; start += 1) {
    let active = (entryStates[start] ?? unmatched).map(copyState);
    const exited: FlowState[] = [];
    for (let index = start; index < clauses.length && active.length > 0; index += 1) {
      const outcome = analyzeStatements(clauses[index].statements, active, context);
      unsafe ||= outcome.unsafe;
      for (const completion of outcome.abrupt) {
        if (completion.kind === 'break' && completion.target === statement) {
          exited.push(copyState(completion.state));
        } else {
          abrupt.push(completion);
        }
      }
      active = outcome.states;
    }
    states.push(...exited, ...active);
  }
  if (defaultIndex < 0) states.push(...unmatched.map(copyState));
  return { states, abrupt, unsafe };
}

function analyzeSwitch(
  statement: ts.SwitchStatement,
  initialStates: FlowState[],
  context: FlowContext
): FlowOutcome {
  const scopedNames = lexicalDeclarationNames(
    statement.caseBlock.clauses.flatMap((clause) => [...clause.statements])
  );
  const hasUsingDeclaration = statement.caseBlock.clauses.some((clause) =>
    clause.statements.some(
      (item) => ts.isVariableStatement(item) && isUsingDeclarationList(item.declarationList)
    )
  );
  const states: FlowState[] = [];
  const abrupt: AbruptCompletion[] = [];
  let unsafe = false;
  for (const outerState of initialStates) {
    const scopedEntry = copyState(outerState);
    for (const name of scopedNames) scopedEntry.aliases.delete(name);
    const outcome = analyzeSwitchClauses(statement, [scopedEntry], context);
    states.push(
      ...outcome.states.map((exit) => restoreScopedAliases(exit, outerState, scopedNames))
    );
    abrupt.push(
      ...[
        ...outcome.abrupt,
        ...(hasUsingDeclaration
          ? [...outcome.states, ...outcome.abrupt.map((completion) => completion.state)].map(
              (exit): AbruptCompletion => ({
                kind: 'throw',
                state: copyState(exit),
                exactOriginal: false
              })
            )
          : [])
      ].map((completion) => ({
        ...completion,
        state: restoreScopedAliases(completion.state, outerState, scopedNames)
      }))
    );
    unsafe ||= outcome.unsafe;
  }
  return { states, abrupt, unsafe };
}

function restoredCatchState(exit: FlowState, outer: FlowState, names: Set<string>): FlowState {
  const restored = copyState(exit);
  for (const name of names) {
    if (outer.aliases.has(name)) restored.aliases.add(name);
    else restored.aliases.delete(name);
  }
  return restored;
}

function applyFinalizer(
  finalizer: ts.Block | undefined,
  states: FlowState[],
  abrupt: AbruptCompletion[],
  context: FlowContext
): FlowOutcome {
  if (!finalizer) return { states, abrupt, unsafe: false };
  const finalizedStates: FlowState[] = [];
  const finalizedAbrupt: AbruptCompletion[] = [];
  let unsafe = false;
  const inputs: Array<{ state: FlowState; completion?: AbruptCompletion }> = [
    ...states.map((state) => ({ state })),
    ...abrupt.map((completion) => ({ state: completion.state, completion }))
  ];
  for (const input of inputs) {
    const finalized = analyzeBlock(finalizer, input.state, context);
    unsafe ||= finalized.unsafe;
    finalizedAbrupt.push(...finalized.abrupt);
    if (input.completion) {
      finalizedAbrupt.push(
        ...finalized.states.map((state) => copyCompletion(input.completion!, state))
      );
    } else {
      finalizedStates.push(...finalized.states);
    }
  }
  return { states: finalizedStates, abrupt: finalizedAbrupt, unsafe };
}

function analyzeTry(
  statement: ts.TryStatement,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  const tried = analyzeBlock(statement.tryBlock, copyState(state), context);
  const states = [...tried.states];
  let abrupt = [...tried.abrupt];
  // A catch handles the try block's possible throw completions. Successful paths still flow into
  // the surrounding evidence checks, so carrying the try's coarse unsafe bit would reject sound
  // guarded inspection/cleanup patterns even when both outcomes preserve the original.
  let unsafe = statement.catchClause ? false : tried.unsafe;
  if (statement.catchClause) {
    const caughtInputs = abrupt.filter((completion) => completion.kind === 'throw');
    abrupt = abrupt.filter((completion) => completion.kind !== 'throw');
    const shadowedNames = new Set<string>();
    if (statement.catchClause.variableDeclaration) {
      collectBindingNames(statement.catchClause.variableDeclaration.name, shadowedNames);
    }
    const caughtContext: FlowContext = {
      ...context,
      foreignAliases: new Set([...context.foreignAliases, ...shadowedNames])
    };
    for (const caughtInput of caughtInputs) {
      const outerStateAtThrow = copyState(caughtInput.state);
      const caughtState = copyState(caughtInput.state);
      for (const name of shadowedNames) caughtState.aliases.delete(name);
      const caught = analyzeBlock(statement.catchClause.block, caughtState, caughtContext);
      states.push(
        ...caught.states.map((exit) => restoredCatchState(exit, outerStateAtThrow, shadowedNames))
      );
      abrupt.push(
        ...caught.abrupt.map((completion) => ({
          ...completion,
          state: restoredCatchState(completion.state, outerStateAtThrow, shadowedNames)
        }))
      );
      unsafe ||= caught.unsafe;
    }
  }
  const finalized = applyFinalizer(statement.finallyBlock, states, abrupt, context);
  return {
    states: finalized.states,
    abrupt: finalized.abrupt,
    unsafe: unsafe || finalized.unsafe
  };
}

function invalidateLoopBinding(state: FlowState, initializer: ts.ForInitializer): FlowState {
  const next = copyState(state);
  if (ts.isVariableDeclarationList(initializer)) {
    for (const declaration of initializer.declarations) {
      const names = new Set<string>();
      collectBindingNames(declaration.name, names);
      for (const name of names) next.aliases.delete(name);
    }
    return next;
  }
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      next.aliases.delete(node.text);
      return;
    }
    if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) {
      ts.forEachChild(node, visit);
    }
  };
  visit(initializer);
  return next;
}

function splitLoopCompletions(
  abrupt: AbruptCompletion[],
  statement: ts.IterationStatement
): { breaks: FlowState[]; continues: FlowState[]; abrupt: AbruptCompletion[] } {
  const breaks: FlowState[] = [];
  const continues: FlowState[] = [];
  const remaining: AbruptCompletion[] = [];
  for (const completion of abrupt) {
    if (completion.kind === 'break' && completion.target === statement) {
      breaks.push(copyState(completion.state));
    } else if (completion.kind === 'continue' && completion.target === statement) {
      continues.push(copyState(completion.state));
    } else {
      remaining.push(completion);
    }
  }
  return { breaks, continues, abrupt: remaining };
}

function analyzeForStatement(
  statement: ts.ForStatement,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  const prepared = statement.initializer
    ? ts.isVariableDeclarationList(statement.initializer)
      ? analyzeVariableDeclarationList(statement.initializer, [state], context)
      : analyzeExpression(statement.initializer, state, context)
    : { states: [copyState(state)], abrupt: [], unsafe: false };
  const conditioned = statement.condition
    ? analyzeExpressionsForStates(statement.condition, prepared.states, context)
    : { states: prepared.states.map(copyState), abrupt: [], unsafe: false };
  const body = analyzeStatements([statement.statement], conditioned.states, context);
  const split = splitLoopCompletions(body.abrupt, statement);
  const iterationInputs = [...body.states, ...split.continues];
  const incremented = statement.incrementor
    ? analyzeExpressionsForStates(statement.incrementor, iterationInputs, context)
    : { states: iterationInputs.map(copyState), abrupt: [], unsafe: false };
  const rechecked = statement.condition
    ? analyzeExpressionsForStates(statement.condition, incremented.states, context)
    : { states: incremented.states.map(copyState), abrupt: [], unsafe: false };
  return {
    states: [
      ...(statement.condition ? conditioned.states.map(copyState) : []),
      ...split.breaks,
      ...(statement.condition ? rechecked.states : [])
    ],
    abrupt: [
      ...prepared.abrupt,
      ...conditioned.abrupt,
      ...split.abrupt,
      ...incremented.abrupt,
      ...rechecked.abrupt
    ],
    unsafe:
      prepared.unsafe ||
      conditioned.unsafe ||
      body.unsafe ||
      incremented.unsafe ||
      rechecked.unsafe ||
      (!statement.condition && iterationInputs.some(stateNeedsEvidence))
  };
}

function analyzeForEachStatement(
  statement: ts.ForInStatement | ts.ForOfStatement,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  const iterable = analyzeExpression(statement.expression, state, context);
  const implicitProtocolFailures = iterable.states.map(
    (next): AbruptCompletion => ({
      kind: 'throw',
      state: copyState(next),
      exactOriginal: false
    })
  );
  const bound = ts.isVariableDeclarationList(statement.initializer)
    ? analyzeVariableDeclarationList(statement.initializer, iterable.states, context)
    : analyzeExpressionsForStates(statement.initializer, iterable.states, context);
  const iterationStates = bound.states.map((item) =>
    invalidateLoopBinding(item, statement.initializer)
  );
  const body = analyzeStatements([statement.statement], iterationStates, context);
  const split = splitLoopCompletions(body.abrupt, statement);
  return {
    states: [
      ...iterable.states.map(copyState),
      ...split.breaks,
      ...body.states,
      ...split.continues
    ],
    abrupt: [...iterable.abrupt, ...implicitProtocolFailures, ...bound.abrupt, ...split.abrupt],
    unsafe: iterable.unsafe || bound.unsafe || body.unsafe
  };
}

function analyzeWhileStatement(
  statement: ts.WhileStatement,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  const conditioned = analyzeExpression(statement.expression, state, context);
  const body = analyzeStatements([statement.statement], conditioned.states, context);
  const split = splitLoopCompletions(body.abrupt, statement);
  const rechecked = analyzeExpressionsForStates(
    statement.expression,
    [...body.states, ...split.continues],
    context
  );
  return {
    states: [...conditioned.states.map(copyState), ...split.breaks, ...rechecked.states],
    abrupt: [...conditioned.abrupt, ...split.abrupt, ...rechecked.abrupt],
    unsafe: conditioned.unsafe || body.unsafe || rechecked.unsafe
  };
}

function analyzeDoStatement(
  statement: ts.DoStatement,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  const body = analyzeStatement(statement.statement, copyState(state), context);
  const split = splitLoopCompletions(body.abrupt, statement);
  const conditioned = analyzeExpressionsForStates(
    statement.expression,
    [...body.states, ...split.continues],
    context
  );
  return {
    states: [...split.breaks, ...conditioned.states],
    abrupt: [...split.abrupt, ...conditioned.abrupt],
    unsafe: body.unsafe || conditioned.unsafe
  };
}

function appendExpressionEvaluation(
  outcome: FlowOutcome,
  expression: ts.Expression,
  context: FlowContext
): FlowOutcome {
  const evaluated = analyzeExpressionsForStates(expression, outcome.states, context);
  return {
    states: evaluated.states,
    abrupt: [...outcome.abrupt, ...evaluated.abrupt],
    unsafe: outcome.unsafe || evaluated.unsafe
  };
}

function appendBlockEvaluation(
  outcome: FlowOutcome,
  block: ts.Block,
  context: FlowContext
): FlowOutcome {
  const states: FlowState[] = [];
  const abrupt = [...outcome.abrupt];
  let unsafe = outcome.unsafe;
  for (const state of outcome.states) {
    const evaluated = analyzeBlock(block, state, context);
    states.push(...evaluated.states);
    abrupt.push(...evaluated.abrupt);
    unsafe ||= evaluated.unsafe;
  }
  return { states, abrupt, unsafe };
}

function nodeHasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind)
  );
}

function decoratorExpressions(node: ts.Node): ts.Expression[] {
  return ts.canHaveDecorators(node)
    ? (ts.getDecorators(node) ?? []).map((decorator) => decorator.expression)
    : [];
}

function withPossibleDeclarationThrow(state: FlowState, outcome: FlowOutcome): FlowOutcome {
  return {
    ...outcome,
    abrupt: [{ kind: 'throw', state: copyState(state), exactOriginal: false }, ...outcome.abrupt]
  };
}

function analyzeClassDeclaration(
  statement: ts.ClassDeclaration,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  let outcome: FlowOutcome = { states: [copyState(state)], abrupt: [], unsafe: false };
  for (const expression of decoratorExpressions(statement)) {
    outcome = appendExpressionEvaluation(outcome, expression, context);
  }
  for (const clause of statement.heritageClauses ?? []) {
    for (const type of clause.types) {
      outcome = appendExpressionEvaluation(outcome, type.expression, context);
    }
  }
  for (const member of statement.members) {
    for (const expression of decoratorExpressions(member)) {
      outcome = appendExpressionEvaluation(outcome, expression, context);
    }
    if ('name' in member && member.name && ts.isComputedPropertyName(member.name)) {
      outcome = appendExpressionEvaluation(outcome, member.name.expression, context);
    }
    if (ts.isClassStaticBlockDeclaration(member)) {
      outcome = appendBlockEvaluation(outcome, member.body, context);
    } else if (
      ts.isPropertyDeclaration(member) &&
      member.initializer &&
      nodeHasModifier(member, ts.SyntaxKind.StaticKeyword)
    ) {
      outcome = appendExpressionEvaluation(outcome, member.initializer, context);
    }
  }
  return withPossibleDeclarationThrow(state, outcome);
}

function analyzeEnumDeclaration(
  statement: ts.EnumDeclaration,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  let outcome: FlowOutcome = { states: [copyState(state)], abrupt: [], unsafe: false };
  for (const expression of decoratorExpressions(statement)) {
    outcome = appendExpressionEvaluation(outcome, expression, context);
  }
  for (const member of statement.members) {
    if (ts.isComputedPropertyName(member.name)) {
      outcome = appendExpressionEvaluation(outcome, member.name.expression, context);
    }
    if (member.initializer) {
      outcome = appendExpressionEvaluation(outcome, member.initializer, context);
    }
  }
  return withPossibleDeclarationThrow(state, outcome);
}

function analyzeModuleDeclaration(
  statement: ts.ModuleDeclaration,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  if (
    ts.isStringLiteral(statement.name) ||
    nodeHasModifier(statement, ts.SyntaxKind.DeclareKeyword) ||
    (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Ambient) !== 0 ||
    !statement.body
  ) {
    return { states: [copyState(state)], abrupt: [], unsafe: false };
  }
  let evaluated: FlowOutcome;
  if (ts.isModuleBlock(statement.body)) {
    evaluated = analyzeStatements(statement.body.statements, [copyState(state)], context);
  } else if (ts.isModuleDeclaration(statement.body)) {
    evaluated = analyzeModuleDeclaration(statement.body, copyState(state), context);
  } else {
    return { states: [copyState(state)], abrupt: [], unsafe: false };
  }
  const restoreAliases = (next: FlowState): FlowState => ({
    ...copyState(next),
    aliases: new Set(state.aliases)
  });
  return withPossibleDeclarationThrow(state, {
    states: evaluated.states.map(restoreAliases),
    abrupt: evaluated.abrupt.map((completion) => ({
      ...completion,
      state: restoreAliases(completion.state)
    })),
    unsafe: evaluated.unsafe
  });
}

function analyzeStatement(
  statement: ts.Statement,
  state: FlowState,
  context: FlowContext
): FlowOutcome {
  if (ts.isBlock(statement)) return analyzeBlock(statement, state, context);
  if (ts.isExpressionStatement(statement)) {
    if (
      ts.isStringLiteral(statement.expression) &&
      ts.isBlock(statement.parent) &&
      statement.parent === context.boundaryBody &&
      ts.isFunctionLike(statement.parent.parent) &&
      'body' in statement.parent.parent &&
      statement.parent.parent.body === statement.parent
    ) {
      const index = statement.parent.statements.indexOf(statement);
      const isDirective = statement.parent.statements
        .slice(0, index + 1)
        .every(
          (candidate) =>
            ts.isExpressionStatement(candidate) && ts.isStringLiteral(candidate.expression)
        );
      if (isDirective) return { states: [copyState(state)], abrupt: [], unsafe: false };
    }
    const capture = captureProtection(statement.expression, state, context);
    const outcome = analyzeExpression(statement.expression, state, context);
    return {
      ...outcome,
      unsafe: outcome.unsafe || (!state.waived && !capture && state.protection === 'none')
    };
  }
  if (ts.isVariableStatement(statement)) {
    return analyzeVariableDeclarationList(statement.declarationList, [state], context);
  }
  if (ts.isReturnStatement(statement)) {
    const evaluated = statement.expression
      ? analyzeExpression(statement.expression, state, context)
      : { states: [copyState(state)], abrupt: [], unsafe: false };
    const returningFromCatch = statement.parent === context.boundaryBody;
    const returnStates = evaluated.states.map((next) => {
      const returned = copyState(next);
      if (returningFromCatch && returned.protection === 'provisional') {
        returned.protection = 'owned';
      }
      return returned;
    });
    return {
      states: [],
      abrupt: [
        ...evaluated.abrupt.filter(
          (completion) =>
            !(
              returningFromCatch &&
              state.protection === 'provisional' &&
              completion.exactOriginal === false
            )
        ),
        ...returnStates.map(
          (next): AbruptCompletion => ({
            kind: 'return',
            state: copyState(next),
            ignoreTarget: true
          })
        )
      ],
      unsafe: evaluated.unsafe
    };
  }
  if (ts.isThrowStatement(statement)) {
    if (!statement.expression) {
      return {
        states: [],
        abrupt: [{ kind: 'throw', state: copyState(state), exactOriginal: false }],
        unsafe: false
      };
    }
    const exactOriginal = isAliasExpression(statement.expression, state.aliases);
    const evaluated = analyzeExpression(statement.expression, state, context);
    return {
      states: [],
      abrupt: [
        ...evaluated.abrupt,
        ...evaluated.states.map(
          (next): AbruptCompletion => ({
            kind: 'throw',
            state: copyState(next),
            exactOriginal,
            ignoreTarget: true
          })
        )
      ],
      unsafe: evaluated.unsafe
    };
  }
  if (ts.isIfStatement(statement)) {
    const condition = analyzeExpression(statement.expression, state, context);
    const whenTrue = analyzeStatements([statement.thenStatement], condition.states, context);
    const whenFalse = statement.elseStatement
      ? analyzeStatements([statement.elseStatement], condition.states, context)
      : { states: condition.states.map(copyState), abrupt: [], unsafe: false };
    return {
      states: [...whenTrue.states, ...whenFalse.states],
      abrupt: [...condition.abrupt, ...whenTrue.abrupt, ...whenFalse.abrupt],
      unsafe: condition.unsafe || whenTrue.unsafe || whenFalse.unsafe
    };
  }
  if (ts.isSwitchStatement(statement)) {
    const discriminant = analyzeExpression(statement.expression, state, context);
    const outcome = analyzeSwitch(statement, discriminant.states, context);
    return {
      states: outcome.states,
      abrupt: [...discriminant.abrupt, ...outcome.abrupt],
      unsafe: discriminant.unsafe || outcome.unsafe
    };
  }
  if (ts.isTryStatement(statement)) return analyzeTry(statement, state, context);
  if (ts.isForStatement(statement)) return analyzeForStatement(statement, state, context);
  if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
    return analyzeForEachStatement(statement, state, context);
  }
  if (ts.isWhileStatement(statement)) return analyzeWhileStatement(statement, state, context);
  if (ts.isDoStatement(statement)) return analyzeDoStatement(statement, state, context);
  if (ts.isBreakStatement(statement)) {
    return {
      states: [],
      abrupt: [
        {
          kind: 'break',
          state: copyState(state),
          target: breakTarget(statement),
          ignoreTarget: true
        }
      ],
      unsafe: false
    };
  }
  if (ts.isContinueStatement(statement)) {
    return {
      states: [],
      abrupt: [
        {
          kind: 'continue',
          state: copyState(state),
          target: continueTarget(statement),
          ignoreTarget: true
        }
      ],
      unsafe: false
    };
  }
  if (ts.isLabeledStatement(statement)) {
    const outcome = analyzeStatement(statement.statement, state, context);
    const states = [...outcome.states];
    const abrupt: AbruptCompletion[] = [];
    for (const completion of outcome.abrupt) {
      if (completion.kind === 'break' && completion.target === statement) {
        states.push(copyState(completion.state));
      } else {
        abrupt.push(completion);
      }
    }
    return { states, abrupt, unsafe: outcome.unsafe };
  }
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  ) {
    return { states: [copyState(state)], abrupt: [], unsafe: false };
  }
  if (ts.isClassDeclaration(statement)) {
    return analyzeClassDeclaration(statement, state, context);
  }
  if (ts.isEnumDeclaration(statement)) return analyzeEnumDeclaration(statement, state, context);
  if (ts.isModuleDeclaration(statement)) {
    return analyzeModuleDeclaration(statement, state, context);
  }
  return {
    states: [copyState(state)],
    abrupt: [],
    unsafe: stateNeedsEvidence(state)
  };
}

function completionHasEvidence(completion: AbruptCompletion): boolean {
  if (
    completion.kind === 'throw' &&
    completion.exactOriginal === true &&
    (completion.state.protection === 'uncertain' || completion.state.terminalizedOriginal)
  ) {
    return false;
  }
  return (
    !!completion.waived ||
    !!completion.state.waived ||
    isTerminalProtection(completion.state.protection) ||
    (completion.kind === 'throw' && completion.exactOriginal === true)
  );
}

function boundaryHasEvidence(
  boundary: Boundary,
  sourceFile: ts.SourceFile,
  facades: Map<string, string>,
  checker: ts.TypeChecker | undefined,
  taintedBindings: Set<ts.Symbol>,
  unknownFacadeEscape: boolean
): boolean {
  if (ts.isBlock(boundary.body)) {
    if (exactIgnoreInsideEmptyBlock(boundary.body, sourceFile)) return true;
  }
  const context: FlowContext = {
    boundaryBody: boundary.body,
    checker,
    facades,
    foreignAliases: new Set(),
    sourceFile,
    taintedBindings,
    unknownFacadeEscape
  };
  const initialState: FlowState = {
    aliases: boundary.binding ? new Set([boundary.binding.text]) : new Set(),
    protection: 'none'
  };
  if (!ts.isBlock(boundary.body)) {
    const outcome = analyzeExpression(boundary.body, initialState, context);
    return (
      !outcome.unsafe &&
      outcome.abrupt.every(completionHasEvidence) &&
      outcome.states.every((state) => state.waived || isTerminalProtection(state.protection))
    );
  }
  let outcome = analyzeBlock(boundary.body, initialState, context);
  if (boundary.finalizer) {
    const outsideCatchScope = (state: FlowState): FlowState => {
      const next = copyState(state);
      if (boundary.binding) next.aliases.delete(boundary.binding.text);
      return next;
    };
    const finalized = applyFinalizer(
      boundary.finalizer,
      outcome.states.map(outsideCatchScope),
      outcome.abrupt.map((completion) => ({
        ...completion,
        state: outsideCatchScope(completion.state)
      })),
      context
    );
    outcome = {
      states: finalized.states,
      abrupt: finalized.abrupt,
      unsafe: outcome.unsafe || finalized.unsafe
    };
  }
  return (
    !outcome.unsafe &&
    outcome.abrupt.every(completionHasEvidence) &&
    outcome.states.every((state) => state.waived || isTerminalProtection(state.protection))
  );
}

function promiseCatchBoundary(call: ts.CallExpression): Boundary | undefined {
  const expression = unwrapExpression(call.expression);
  const elementKey =
    ts.isElementAccessExpression(expression) && expression.argumentExpression
      ? unwrapExpression(expression.argumentExpression)
      : undefined;
  const memberName = ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : ts.isElementAccessExpression(expression) &&
        expression.argumentExpression &&
        elementKey &&
        (ts.isStringLiteral(elementKey) || ts.isNoSubstitutionTemplateLiteral(elementKey)) &&
        (elementKey.text === 'catch' || elementKey.text === 'then')
      ? elementKey.text
      : undefined;
  if (memberName !== 'catch' && memberName !== 'then') return undefined;
  const diagnosticNode = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : ts.isElementAccessExpression(expression)
      ? expression.argumentExpression
      : undefined;
  if (!diagnosticNode) return undefined;
  const callback = call.arguments[memberName === 'then' ? 1 : 0];
  if (!callback) return undefined;
  const unwrappedCallback = unwrapExpression(callback);
  const inlineCallback =
    ts.isArrowFunction(unwrappedCallback) ||
    (ts.isFunctionExpression(unwrappedCallback) && !unwrappedCallback.asteriskToken)
      ? unwrappedCallback
      : undefined;
  const parameter = inlineCallback?.parameters[0];
  return {
    body: inlineCallback?.body ?? callback,
    binding:
      parameter &&
      ts.isIdentifier(parameter.name) &&
      !parameter.dotDotDotToken &&
      !parameter.initializer
        ? parameter.name
        : undefined,
    diagnosticNode,
    rule: 'UNCAPTURED_PROMISE_REJECTION'
  };
}

function findingFor(
  boundary: Boundary,
  sourceFile: ts.SourceFile,
  filePath: string
): ErrorTelemetryFinding {
  const position = sourceFile.getLineAndCharacterOfPosition(
    boundary.diagnosticNode.getStart(sourceFile)
  );
  const isPromise = boundary.rule === 'UNCAPTURED_PROMISE_REJECTION';
  return {
    path: normalizePath(filePath),
    line: position.line + 1,
    column: position.character + 1,
    rule: boundary.rule,
    message: isPromise
      ? 'Promise catch callback does not capture or rethrow its rejection'
      : 'catch boundary does not capture or rethrow its error'
  };
}

export function scanSource(sourceText: string, filePath: string): ErrorTelemetryFinding[] {
  if (isExcludedPath(filePath)) return [];
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const facades = importedFacades(sourceFile, filePath);
  const checker = sourceMayEnterDeferredProtection(sourceFile, facades)
    ? sourceFileTypeChecker(sourceFile)
    : undefined;
  const facadeBindings = checker
    ? runtimeFacadeBindingSymbols(sourceFile, facades, checker)
    : new Set<ts.Symbol>();
  const taintedBindings = checker
    ? terminalizingTaintedBindings(sourceFile, checker, facadeBindings)
    : new Set<ts.Symbol>();
  const capabilityAnalysis = checker
    ? escapableCapabilityBindings(sourceFile, checker, facadeBindings, facades)
    : undefined;
  const unknownFacadeEscape =
    checker && capabilityAnalysis
      ? sourceHasUnknownFacadeEscape(sourceFile, facades, capabilityAnalysis, checker)
      : false;
  const findings: ErrorTelemetryFinding[] = [];

  const visit = (node: ts.Node): void => {
    let boundary: Boundary | undefined;
    if (ts.isCatchClause(node)) {
      const enclosingTry = ts.isTryStatement(node.parent) ? node.parent : undefined;
      boundary = {
        body: node.block,
        binding:
          node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)
            ? node.variableDeclaration.name
            : undefined,
        diagnosticNode: node,
        finalizer: enclosingTry?.finallyBlock,
        rule: 'UNCAPTURED_CATCH'
      };
    } else if (ts.isCallExpression(node)) {
      boundary = promiseCatchBoundary(node);
    }
    if (
      boundary &&
      !boundaryHasEvidence(
        boundary,
        sourceFile,
        facades,
        checker,
        taintedBindings,
        unknownFacadeEscape
      )
    ) {
      findings.push(findingFor(boundary, sourceFile, filePath));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column
  );
}

export async function scanFiles(
  filePaths: string[],
  options: { cwd?: string } = {}
): Promise<ErrorTelemetryFinding[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const findings: ErrorTelemetryFinding[] = [];
  for (const filePath of [...filePaths].sort()) {
    const absolute = path.resolve(filePath);
    const displayPath = normalizePath(path.relative(cwd, absolute));
    if (isExcludedPath(displayPath)) continue;
    findings.push(...scanSource(await readFile(absolute, 'utf8'), displayPath));
  }
  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column
  );
}

async function walk(directory: string, root: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = normalizePath(path.relative(root, absolute));
    if (isExcludedPath(relative)) continue;
    if (entry.isDirectory()) {
      await walk(absolute, root, files);
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
}

export async function productionSourceFiles(root = process.cwd()): Promise<string[]> {
  const absoluteRoot = path.resolve(root);
  const files: string[] = [];
  for (const familyRoot of ['apps', 'packages']) {
    const absoluteFamilyRoot = path.join(absoluteRoot, familyRoot);
    for (const entry of await readdir(absoluteFamilyRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sourceRoot = path.join(absoluteFamilyRoot, entry.name, 'src');
      try {
        await walk(sourceRoot, absoluteRoot, files);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  return files.sort();
}

export async function scanProductionSources(
  root = process.cwd()
): Promise<ErrorTelemetryFinding[]> {
  const absoluteRoot = path.resolve(root);
  return scanFiles(await productionSourceFiles(absoluteRoot), { cwd: absoluteRoot });
}

async function main(): Promise<void> {
  const root = process.cwd();
  const findings = await scanProductionSources(root);
  if (findings.length === 0) {
    console.log('Error telemetry coverage: 0 uncovered boundaries');
    return;
  }
  for (const finding of findings) {
    console.error(
      `${finding.path}:${finding.line}:${finding.column} ${finding.rule} ${finding.message}`
    );
  }
  console.error(`Error telemetry coverage: ${findings.length} uncovered boundaries`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
