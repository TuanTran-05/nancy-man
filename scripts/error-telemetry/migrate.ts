import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  isExcludedPath,
  isNameShadowedAtNode,
  isProductionSourcePath,
  isRuntimeFacadeModule,
  isUnboundGlobalAtNode,
  normalizePath,
  productionSourceFiles,
  scanSource,
  type ErrorTelemetryFinding
} from './coverage.ts';

type TextEdit = { start: number; end: number; text: string };

export type UnsupportedMigration = {
  path: string;
  line: number;
  column: number;
  reason: string;
};

function unsupportedFinding(finding: ErrorTelemetryFinding, reason: string): UnsupportedMigration {
  return {
    path: finding.path,
    line: finding.line,
    column: finding.column,
    reason
  };
}

export type MigrationResult = {
  changed: boolean;
  migratedBoundaries: number;
  sourceText: string;
  unsupported?: UnsupportedMigration[];
};

type RuntimeFamily = 'node' | 'browser';
type FacadeName = 'captureOpsException' | 'captureBrowserException';
type MigratorFacadeName = FacadeName | 'captureApiError' | 'handleApiError' | 'sendApiError';

type RequestContextBindings = {
  request?: string;
  response?: string;
};

type AstBoundary = {
  body?: ts.Block | ts.ConciseBody;
  callback?: ts.ArrowFunction | ts.FunctionExpression;
  catchClause?: ts.CatchClause;
  diagnosticNode: ts.Node;
  finding: ErrorTelemetryFinding;
  handler?: ts.Expression;
};

function sourceFileFor(sourceText: string, filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function parseDiagnostics(sourceFile: ts.SourceFile, filePath: string): UnsupportedMigration[] {
  const diagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }
  ).parseDiagnostics;
  return diagnostics.map((diagnostic) => {
    const start = diagnostic.start ?? 0;
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      path: normalizePath(filePath),
      line: location.line + 1,
      column: location.character + 1,
      reason: `TypeScript parse error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
    };
  });
}

function runtimeFamily(filePath: string): RuntimeFamily {
  const normalized = normalizePath(filePath).replace(/^\/+/, '');
  if (normalized.startsWith('apps/web/src/web/')) return 'browser';
  return 'node';
}

function nodeTelemetryImport(filePath: string): string {
  const normalized = normalizePath(filePath);
  const app = normalized.replace(/^\/+/, '').match(/^apps\/([^/]+)\/src\//)?.[1];
  const target = app
    ? app === 'web'
      ? 'apps/web/src/server/telemetry/runtimeTelemetry.js'
      : `apps/${app}/src/telemetry/runtimeTelemetry.js`
    : 'packages/telemetry-sdk/src/runtimeCaptureFacade.js';
  let relative = normalizePath(path.posix.relative(path.posix.dirname(normalized), target));
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative;
}

function browserTelemetryImport(filePath: string): string {
  const normalized = normalizePath(filePath);
  const target = 'apps/web/src/web/telemetry/runtimeTelemetry.js';
  let relative = normalizePath(path.posix.relative(path.posix.dirname(normalized), target));
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative;
}

function expectedFacade(filePath: string): {
  exportedName: FacadeName;
  modulePath: string;
} {
  return runtimeFamily(filePath) === 'node'
    ? { exportedName: 'captureOpsException', modulePath: nodeTelemetryImport(filePath) }
    : {
        exportedName: 'captureBrowserException',
        modulePath: browserTelemetryImport(filePath)
      };
}

function importMatchesRuntime(
  declaration: ts.ImportDeclaration,
  filePath: string,
  exportedName: FacadeName
): boolean {
  if (!ts.isStringLiteral(declaration.moduleSpecifier)) return false;
  return isRuntimeFacadeModule(filePath, exportedName, declaration.moduleSpecifier.text);
}

function existingFacadeLocalName(
  sourceFile: ts.SourceFile,
  filePath: string,
  boundaryNode: ts.Node
): string | undefined {
  const { exportedName } = expectedFacade(filePath);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !importMatchesRuntime(statement, filePath, exportedName)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (
        !element.isTypeOnly &&
        (element.propertyName ?? element.name).text === exportedName &&
        !isNameShadowedAtNode(element.name.text, boundaryNode)
      ) {
        return element.name.text;
      }
    }
  }
  return undefined;
}

function allDeclaredNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const collectBinding = (binding: ts.BindingName): void => {
    if (ts.isIdentifier(binding)) {
      names.add(binding.text);
      return;
    }
    for (const element of binding.elements) {
      if (!ts.isOmittedExpression(element)) collectBinding(element.name);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      collectBinding(node.name);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)) &&
      node.name
    ) {
      names.add(node.name.text);
    } else if (ts.isImportSpecifier(node)) {
      names.add(node.name.text);
    } else if (ts.isImportClause(node) && node.name) {
      names.add(node.name.text);
    } else if (ts.isNamespaceImport(node)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function uniqueName(base: string, unavailable: Set<string>): string {
  if (!unavailable.has(base)) return base;
  let suffix = 'Telemetry';
  while (unavailable.has(`${base}${suffix}`)) suffix += 'Telemetry';
  return `${base}${suffix}`;
}

function lineEndAfter(text: string, position: number): number {
  const lineFeed = text.indexOf('\n', position);
  return lineFeed >= 0 ? lineFeed + 1 : text.length;
}

function facadeImportInsertion(sourceFile: ts.SourceFile): number {
  const text = sourceFile.text;
  let insertion = text.startsWith('#!') ? lineEndAfter(text, 0) : 0;
  let cursor = insertion;
  while (cursor < text.length) {
    const lineEnd = lineEndAfter(text, cursor);
    const line = text.slice(cursor, lineEnd);
    if (!/^\s*\/\/\/\s*<reference\b/.test(line) && !/^\s*$/.test(line)) break;
    insertion = lineEnd;
    cursor = lineEnd;
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      break;
    }
    insertion = lineEndAfter(text, statement.getEnd());
  }
  return insertion;
}

function facadeBinding(
  sourceFile: ts.SourceFile,
  filePath: string,
  boundaryNode: ts.Node
): { localName: string; importEdit?: TextEdit } {
  const existing = existingFacadeLocalName(sourceFile, filePath, boundaryNode);
  if (existing) return { localName: existing };
  const { exportedName, modulePath } = expectedFacade(filePath);
  const localName = uniqueName(exportedName, allDeclaredNames(sourceFile));
  const imported = localName === exportedName ? exportedName : `${exportedName} as ${localName}`;
  const importText = `import { ${imported} } from '${modulePath}';\n\n`;
  const insertion = facadeImportInsertion(sourceFile);
  return { localName, importEdit: { start: insertion, end: insertion, text: importText } };
}

function applyEdits(sourceText: string, edits: TextEdit[]): string {
  let next = sourceText;
  for (const edit of edits.sort(
    (left, right) => right.start - left.start || right.end - left.end
  )) {
    next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`;
  }
  return next;
}

function importedFacadeNames(
  sourceFile: ts.SourceFile,
  filePath: string
): Map<string, MigratorFacadeName> {
  const names = new Map<string, MigratorFacadeName>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const exported = (element.propertyName ?? element.name).text;
      if (
        (exported === 'captureOpsException' ||
          exported === 'captureApiError' ||
          exported === 'captureBrowserException' ||
          exported === 'handleApiError' ||
          exported === 'sendApiError') &&
        isRuntimeFacadeModule(filePath, exported, statement.moduleSpecifier.text)
      ) {
        names.set(element.name.text, exported);
      }
    }
  }
  return names;
}

function directCallFromExpression(expression: ts.Expression): ts.CallExpression | undefined {
  let current = unwrapExpression(expression);
  while (ts.isAwaitExpression(current) || ts.isVoidExpression(current)) {
    current = unwrapExpression(current.expression);
  }
  return ts.isCallExpression(current) ? current : undefined;
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

function isSafelyCallableRejectionHandler(expression: ts.Expression): boolean {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  if (ts.isIdentifier(current)) return true;
  if (ts.isPropertyAccessExpression(current)) return !current.questionDotToken;
  return ts.isElementAccessExpression(current) && !current.questionDotToken;
}

function directStatementFacade(
  statement: ts.Statement,
  facades: Map<string, MigratorFacadeName>
): MigratorFacadeName | undefined {
  const expression = ts.isExpressionStatement(statement)
    ? statement.expression
    : ts.isReturnStatement(statement)
      ? statement.expression
      : undefined;
  if (!expression) return undefined;
  const call = directCallFromExpression(expression);
  if (
    !call ||
    !ts.isIdentifier(call.expression) ||
    isNameShadowedAtNode(call.expression.text, call)
  ) {
    return undefined;
  }
  return facades.get(call.expression.text);
}

function boundaryErrorName(boundary: AstBoundary): string | undefined {
  const name =
    boundary.catchClause?.variableDeclaration?.name ?? boundary.callback?.parameters[0]?.name;
  return name && ts.isIdentifier(name) ? name.text : undefined;
}

function functionCallbackUsesArguments(boundary: AstBoundary): boolean {
  return (
    !!boundary.callback &&
    ts.isFunctionExpression(boundary.callback) &&
    identifierNamesWithin(boundary.callback.body).has('arguments')
  );
}

function boundaryContainsDirectEval(boundary: AstBoundary): boolean {
  if (!boundary.body) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isIdentifier(callee) && callee.text === 'eval') {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(boundary.body);
  return found;
}

function staticObjectPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!('name' in property) || !property.name || property.name.getSourceFile() === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    return property.name.text;
  return undefined;
}

function exactGenericPreemptingCapture(
  statement: ts.Statement,
  boundary: AstBoundary,
  facade: MigratorFacadeName
): boolean {
  if (facade !== 'captureApiError' || !ts.isExpressionStatement(statement)) return false;
  const call = directCallFromExpression(statement.expression);
  if (!call || call.arguments.length !== 1) return false;
  const input = unwrapExpression(call.arguments[0]);
  if (!ts.isObjectLiteralExpression(input)) return false;
  const properties = new Map<string, ts.Expression>();
  for (const property of input.properties) {
    const name = staticObjectPropertyName(property);
    if (!name || properties.has(name)) return false;
    if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(name, property.name);
    } else if (ts.isPropertyAssignment(property)) {
      properties.set(name, unwrapExpression(property.initializer));
    } else {
      return false;
    }
  }
  if (![4, 5].includes(properties.size)) return false;
  if (
    [...properties.keys()].some(
      (name) => !['error', 'code', 'safeMessage', 'status', 'source'].includes(name)
    )
  ) {
    return false;
  }
  const errorName = boundaryErrorName(boundary);
  const error = properties.get('error');
  const code = properties.get('code');
  const safeMessage = properties.get('safeMessage');
  const status = properties.get('status');
  const source = properties.get('source');
  return (
    !!errorName &&
    !!error &&
    ts.isIdentifier(error) &&
    error.text === errorName &&
    !!code &&
    ts.isStringLiteral(code) &&
    code.text === 'UNHANDLED_SERVER_ERROR' &&
    !!safeMessage &&
    ts.isStringLiteral(safeMessage) &&
    safeMessage.text === 'Internal server error' &&
    !!status &&
    ts.isNumericLiteral(status) &&
    status.text === '500' &&
    (!source || (ts.isStringLiteral(source) && source.text === 'api'))
  );
}

function preemptingRethrowCaptureEdits(
  boundary: AstBoundary,
  sourceFile: ts.SourceFile,
  filePath: string
): TextEdit[] | undefined {
  if (!boundary.body || !ts.isBlock(boundary.body)) return undefined;
  const statements = boundary.body.statements;
  if (statements.length !== 2 || !ts.isExpressionStatement(statements[0])) return undefined;
  const rethrow = statements[1];
  const errorName = boundaryErrorName(boundary);
  if (
    !errorName ||
    !ts.isThrowStatement(rethrow) ||
    !rethrow.expression ||
    !ts.isIdentifier(unwrapExpression(rethrow.expression)) ||
    (unwrapExpression(rethrow.expression) as ts.Identifier).text !== errorName
  ) {
    return undefined;
  }
  const facades = importedFacadeNames(sourceFile, filePath);
  const facade = directStatementFacade(statements[0], facades);
  if (facade !== 'captureOpsException' && facade !== 'captureBrowserException') return undefined;
  const call = directCallFromExpression(statements[0].expression);
  const capturedError = call?.arguments[0] ? unwrapExpression(call.arguments[0]) : undefined;
  const context = call?.arguments[1] ? unwrapExpression(call.arguments[1]) : undefined;
  if (
    !capturedError ||
    !ts.isIdentifier(capturedError) ||
    capturedError.text !== errorName ||
    !context ||
    !ts.isObjectLiteralExpression(context) ||
    context.properties.some(
      (property) => staticObjectPropertyName(property) === 'deferUntilHandled'
    )
  ) {
    return undefined;
  }
  const lastProperty = context.properties.at(-1);
  const insertion = lastProperty ? lastProperty.getEnd() : context.getStart(sourceFile) + 1;
  return [
    {
      start: insertion,
      end: insertion,
      text: `${lastProperty ? ', ' : ''}deferUntilHandled: true`
    }
  ];
}

function preemptingWrapperEdits(
  sourceText: string,
  sourceFile: ts.SourceFile,
  boundary: AstBoundary,
  filePath: string
): TextEdit[] | UnsupportedMigration | undefined {
  if (!boundary.body || !ts.isBlock(boundary.body)) return undefined;
  const statements = boundary.body.statements;
  if (statements.length < 2) return undefined;
  const facades = importedFacadeNames(sourceFile, filePath);
  const firstFacade = directStatementFacade(statements[0], facades);
  if (firstFacade !== 'captureApiError' && firstFacade !== 'captureBrowserException') {
    return undefined;
  }
  const wrapperIndex = statements.findIndex((statement, index) => {
    if (index === 0) return false;
    const facade = directStatementFacade(statement, facades);
    return facade === 'handleApiError' || facade === 'sendApiError';
  });
  if (wrapperIndex < 1) return undefined;
  const isProvenLogStatement = (statement: ts.Statement): boolean => {
    if (!ts.isExpressionStatement(statement)) return false;
    const call = directCallFromExpression(statement.expression);
    if (!call) return false;
    const expression = call.expression;
    const isSideEffectFreeArgument = (argument: ts.Expression): boolean => {
      let current = argument;
      while (
        ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isSatisfiesExpression(current)
      ) {
        current = current.expression;
      }
      return (
        ts.isIdentifier(current) ||
        ts.isStringLiteral(current) ||
        ts.isNumericLiteral(current) ||
        ts.isNoSubstitutionTemplateLiteral(current) ||
        current.kind === ts.SyntaxKind.TrueKeyword ||
        current.kind === ts.SyntaxKind.FalseKeyword ||
        current.kind === ts.SyntaxKind.NullKeyword
      );
    };
    return (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'console' &&
      isUnboundGlobalAtNode('console', call) &&
      ['debug', 'error', 'info', 'log', 'warn'].includes(expression.name.text) &&
      call.arguments.every(isSideEffectFreeArgument)
    );
  };
  if (statements.slice(1, wrapperIndex).some((statement) => !isProvenLogStatement(statement))) {
    return unsupportedFinding(
      boundary.finding,
      'preempting capture has non-log effects before the exact response wrapper'
    );
  }
  if (!exactGenericPreemptingCapture(statements[0], boundary, firstFacade)) {
    return unsupportedFinding(
      boundary.finding,
      'preempting capture is not the exact generic migration shape'
    );
  }
  const wrapper = statements[wrapperIndex];
  const intervening = statements.slice(1, wrapperIndex);
  if (intervening.length === 0) {
    return [
      {
        start: statements[0].getStart(sourceFile),
        end: wrapper.getStart(sourceFile),
        text: ''
      },
      ...rewrittenLineEndingEdits(sourceText, [
        statements[0].getStart(sourceFile),
        wrapper.getStart(sourceFile)
      ])
    ];
  }
  if (!ts.isReturnStatement(wrapper) || !wrapper.expression) return undefined;
  const indent = indentationAt(sourceText, wrapper.getStart(sourceFile));
  const responseName = uniqueName('telemetryResponse', allDeclaredNames(sourceFile));
  const middle = intervening.map((statement) => statement.getText(sourceFile)).join(`\n${indent}`);
  return [
    {
      start: statements[0].getStart(sourceFile),
      end: wrapper.getEnd(),
      text: `const ${responseName} = ${wrapper.expression.getText(sourceFile)};\n${indent}${middle}\n${indent}return ${responseName};`
    },
    ...rewrittenLineEndingEdits(sourceText, [statements[0].getStart(sourceFile), wrapper.getEnd()])
  ];
}

function isUnsupportedMigration(
  value: TextEdit[] | UnsupportedMigration
): value is UnsupportedMigration {
  return !Array.isArray(value);
}

function rewrittenLineEndingEdits(sourceText: string, positions: number[]): TextEdit[] {
  const edits = new Map<number, TextEdit>();
  for (const position of positions) {
    const newline = sourceText.indexOf('\n', position);
    if (newline > 0 && sourceText[newline - 1] === '\r') {
      edits.set(newline - 1, { start: newline - 1, end: newline, text: '' });
    }
  }
  return [...edits.values()];
}

function indentationAt(sourceText: string, position: number): string {
  const lineStart = sourceText.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const prefix = sourceText.slice(lineStart, position);
  return /^\s*$/.test(prefix) ? prefix : (prefix.match(/^\s*/)?.[0] ?? '');
}

function preferredIndent(sourceText: string, block: ts.Block): { body: string; base: string } {
  const base = indentationAt(sourceText, block.getStart());
  const first = block.statements[0];
  if (first) {
    const firstIndent = indentationAt(sourceText, first.getStart());
    if (firstIndent.length > base.length) return { body: firstIndent, base };
  }
  return { body: `${base}  `, base };
}

type OpsSource = 'api' | 'browser' | 'database' | 'document_store' | 'job' | 'process' | 'provider';

function boundaryOperationText(node: ts.Node, sourceFile: ts.SourceFile): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCatchClause(current) && ts.isTryStatement(current.parent)) {
      return current.parent.tryBlock.getText(sourceFile);
    }
    if (ts.isCallExpression(current) && promiseRejectionBoundary(current)) {
      const expression = current.expression;
      return ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
        ? expression.expression.getText(sourceFile)
        : expression.getText(sourceFile);
    }
    current = current.parent;
  }
  return '';
}

function boundaryOperationNode(node: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCatchClause(current) && ts.isTryStatement(current.parent)) {
      return current.parent.tryBlock;
    }
    if (ts.isCallExpression(current) && promiseRejectionBoundary(current)) {
      const expression = current.expression;
      return ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
        ? expression.expression
        : expression;
    }
    current = current.parent;
  }
  return undefined;
}

function containsSqlClientQuery(node: ts.Node | undefined): boolean {
  if (!node) return false;
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found || (child !== node && ts.isFunctionLike(child))) return;
    if (ts.isCallExpression(child)) {
      const expression = child.expression;
      const name = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : ts.isElementAccessExpression(expression) &&
            expression.argumentExpression &&
            ts.isStringLiteral(expression.argumentExpression)
          ? expression.argumentExpression.text
          : undefined;
      const first = child.arguments[0];
      const sql =
        first &&
        (ts.isStringLiteral(first) ||
          ts.isNoSubstitutionTemplateLiteral(first) ||
          ts.isTemplateExpression(first))
          ? ts.isTemplateExpression(first)
            ? first.head.text
            : first.text
          : undefined;
      if (
        name === 'query' &&
        sql &&
        /^\s*(?:begin|commit|delete|explain|insert|rollback|select|set|show|update|with)\b/i.test(
          sql
        )
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function containsDatabaseOperation(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const operation = boundaryOperationText(node, sourceFile);
  return (
    containsSqlClientQuery(boundaryOperationNode(node)) ||
    /\bgetDb\s*\(|\.collection\s*\(|\b(?:sql|pool|database|documentStore)\b/i.test(operation)
  );
}

function containsProviderOperation(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const operation = boundaryOperationText(node, sourceFile);
  return (
    /\b(?:fetch|gateway|getPayOSClient|sendZalo\w*|sendSms\w*|sendServerPaymentConfirmation|sendServerPaymentNeedsReviewNotification|sendNeedsReviewNotification)\s*\(/.test(
      operation
    ) || /\.models\.generateContent\s*\(/.test(operation)
  );
}

function isMixedProviderDatabaseBoundary(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  return containsDatabaseOperation(node, sourceFile) && containsProviderOperation(node, sourceFile);
}

function opsSource(filePath: string, node: ts.Node, sourceFile: ts.SourceFile): OpsSource {
  const normalized = `/${normalizePath(filePath).replace(/^\/+/, '')}`;
  if (runtimeFamily(filePath) === 'browser') return 'browser';
  if (
    /\/src\/(?:index|runtime\/|cli\/|cleanup\/)/.test(normalized) ||
    /\/(?:collector-entry|failsafe-main|web-server)\.ts$/.test(normalized)
  ) {
    return 'process';
  }
  if (containsDatabaseOperation(node, sourceFile)) return 'database';
  if (containsProviderOperation(node, sourceFile)) return 'provider';
  if (
    /\b(?:readFile|readFileSync|writeFile|writeFileSync|open|rename|unlink|lstat|stat|mkdir)\s*\(/.test(
      boundaryOperationText(node, sourceFile)
    )
  ) {
    return 'document_store';
  }
  if (
    normalized.startsWith('/apps/processor/') ||
    normalized.startsWith('/apps/notifier/') ||
    normalized.startsWith('/apps/config-agent/') ||
    normalized.startsWith('/apps/sql-worker/') ||
    normalized.includes('/server/collector/') ||
    normalized.includes('/jobs/')
  ) {
    return 'job';
  }
  return 'api';
}

function requestContextBindings(node: ts.Node, sourceFile: ts.SourceFile): RequestContextBindings {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) {
      let request: string | undefined;
      let response: string | undefined;
      for (const parameter of current.parameters) {
        if (!ts.isIdentifier(parameter.name)) continue;
        const name = parameter.name.text;
        const type = parameter.type?.getText(sourceFile) ?? '';
        if (
          !request &&
          (name === 'req' || name === 'request') &&
          (!type || /\b(?:Api)?Request\b/.test(type))
        ) {
          request = name;
        }
        if (
          !response &&
          (name === 'res' || name === 'response') &&
          (!type || /\b(?:Api)?Response\b/.test(type))
        ) {
          response = name;
        }
      }
      if (request || response) return { request, response };
    }
    current = current.parent;
  }
  return {};
}

function captureLines(
  localName: string,
  errorName: string,
  filePath: string,
  indent: string,
  requestContext: RequestContextBindings,
  boundaryNode: ts.Node,
  sourceFile: ts.SourceFile
): string[] {
  let enclosing: ts.Node | undefined = boundaryNode;
  while (enclosing && !ts.isCallExpression(enclosing)) enclosing = enclosing.parent;
  const code =
    enclosing && ts.isCallExpression(enclosing) && promiseRejectionBoundary(enclosing)
      ? 'UNHANDLED_PROMISE_REJECTION'
      : runtimeFamily(filePath) === 'browser'
        ? 'UNHANDLED_BROWSER_EXCEPTION'
        : 'UNHANDLED_OPS_EXCEPTION';
  if (runtimeFamily(filePath) === 'browser') {
    return [
      `void ${localName}(${errorName}, {`,
      `${indent}  code: '${code}',`,
      `${indent}  source: 'browser',`,
      `${indent}  route: () => globalThis.location?.pathname,`,
      `${indent}});`
    ];
  }
  return [
    `${localName}(${errorName}, {`,
    `${indent}  code: '${code}',`,
    `${indent}  source: '${opsSource(filePath, boundaryNode, sourceFile)}',`,
    `${indent}  status: 500,`,
    ...(requestContext.response
      ? [
          `${indent}  requestId: () => typeof ${requestContext.response}.locals?.requestId === 'string' ? ${requestContext.response}.locals.requestId : undefined,`
        ]
      : []),
    ...(requestContext.request
      ? [
          `${indent}  route: () => (${requestContext.request}.originalUrl || ${requestContext.request}.url || '').split('?', 1)[0] || undefined,`,
          `${indent}  method: () => ${requestContext.request}.method,`
        ]
      : []),
    `${indent}});`
  ];
}

function blockCaptureEdit(
  sourceText: string,
  block: ts.Block,
  localName: string,
  errorName: string,
  filePath: string,
  requestContext: RequestContextBindings,
  boundaryNode: ts.Node,
  sourceFile: ts.SourceFile
): TextEdit {
  const { body: indent, base } = preferredIndent(sourceText, block);
  const lines = captureLines(
    localName,
    errorName,
    filePath,
    indent,
    requestContext,
    boundaryNode,
    sourceFile
  );
  let insertionIndex = 0;
  if (ts.isFunctionLike(block.parent) && 'body' in block.parent && block.parent.body === block) {
    while (insertionIndex < block.statements.length) {
      const statement = block.statements[insertionIndex];
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
        break;
      }
      insertionIndex += 1;
    }
  }
  const first = block.statements[insertionIndex];
  if (first) {
    return {
      start: first.getStart(),
      end: first.getStart(),
      text: `${lines.join('\n')}\n${indent}`
    };
  }
  if (insertionIndex > 0) {
    const lastDirective = block.statements[insertionIndex - 1];
    return {
      start: lastDirective.getEnd(),
      end: lastDirective.getEnd(),
      text: `\n${indent}${lines.join('\n')}`
    };
  }
  const existingTrivia = sourceText.slice(block.getStart() + 1, block.getEnd() - 1);
  return {
    start: block.getStart() + 1,
    end: block.getStart() + 1,
    text:
      existingTrivia.length > 0
        ? `\n${indent}${lines.join('\n')}`
        : `\n${indent}${lines.join('\n')}\n${base}`
  };
}

function findingKey(finding: ErrorTelemetryFinding): string {
  return `${finding.rule}:${finding.line}:${finding.column}`;
}

function promiseRejectionBoundary(
  call: ts.CallExpression
): { diagnosticNode: ts.Node; handlerIndex: number } | undefined {
  const expression = unwrapExpression(call.expression);
  if (
    ts.isPropertyAccessExpression(expression) &&
    (expression.name.text === 'catch' || expression.name.text === 'then')
  ) {
    return {
      diagnosticNode: expression.name,
      handlerIndex: expression.name.text === 'then' ? 1 : 0
    };
  }
  const argument =
    ts.isElementAccessExpression(expression) && expression.argumentExpression
      ? unwrapExpression(expression.argumentExpression)
      : undefined;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    argument &&
    (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) &&
    (argument.text === 'catch' || argument.text === 'then')
  ) {
    return {
      diagnosticNode: expression.argumentExpression,
      handlerIndex: argument.text === 'then' ? 1 : 0
    };
  }
  return undefined;
}

function astBoundaries(
  sourceFile: ts.SourceFile,
  findings: ErrorTelemetryFinding[]
): AstBoundary[] {
  const byKey = new Map(findings.map((finding) => [findingKey(finding), finding]));
  const boundaries: AstBoundary[] = [];
  const visit = (node: ts.Node): void => {
    let diagnosticNode: ts.Node | undefined;
    let body: ts.Block | ts.ConciseBody | undefined;
    let callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
    let catchClause: ts.CatchClause | undefined;
    let handler: ts.Expression | undefined;
    let rule: ErrorTelemetryFinding['rule'] | undefined;
    if (ts.isCatchClause(node)) {
      diagnosticNode = node;
      body = node.block;
      catchClause = node;
      rule = 'UNCAPTURED_CATCH';
    } else if (ts.isCallExpression(node)) {
      const rejectionBoundary = promiseRejectionBoundary(node);
      diagnosticNode = rejectionBoundary?.diagnosticNode;
      if (diagnosticNode && rejectionBoundary) {
        const candidate = node.arguments[rejectionBoundary.handlerIndex];
        if (candidate && (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate))) {
          body = candidate.body;
          callback = candidate;
          rule = 'UNCAPTURED_PROMISE_REJECTION';
        } else if (candidate && ts.isExpression(candidate)) {
          handler = candidate;
          rule = 'UNCAPTURED_PROMISE_REJECTION';
        }
      }
    }
    if (diagnosticNode && (body || handler) && rule) {
      const location = sourceFile.getLineAndCharacterOfPosition(
        diagnosticNode.getStart(sourceFile)
      );
      const key = `${rule}:${location.line + 1}:${location.character + 1}`;
      const finding = byKey.get(key);
      if (finding) {
        boundaries.push({ body, callback, catchClause, diagnosticNode, finding, handler });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return boundaries;
}

function identifierNamesWithin(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) {
      const parent = child.parent;
      const isNonReferenceName =
        (ts.isPropertyAccessExpression(parent) && parent.name === child) ||
        (ts.isPropertyAssignment(parent) && parent.name === child) ||
        (ts.isBindingElement(parent) && parent.propertyName === child) ||
        (ts.isLabeledStatement(parent) && parent.label === child) ||
        ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === child);
      if (!isNonReferenceName) names.add(child.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function callbackBindingEdit(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  errorName: string
): TextEdit | undefined {
  if (callback.parameters.length > 0) return undefined;
  return {
    start: callback.parameters.pos,
    end: callback.parameters.end,
    text: errorName
  };
}

function replacementErrorCauseEdits(body: ts.Node, errorName: string): TextEdit[] {
  const edits: TextEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== body && (ts.isFunctionLike(node) || ts.isCatchClause(node))) return;
    if (ts.isThrowStatement(node) && node.expression) {
      const expression = node.expression;
      if (
        ts.isNewExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'Error' &&
        isUnboundGlobalAtNode('Error', expression) &&
        expression.arguments &&
        expression.arguments.length <= 1
      ) {
        const closingParenthesis = expression.getEnd() - 1;
        edits.push({
          start: closingParenthesis,
          end: closingParenthesis,
          text: `${expression.arguments.length === 0 ? '' : ', '}{ cause: ${errorName} }`
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return edits;
}

function migrationEditsForBoundary(
  sourceText: string,
  sourceFile: ts.SourceFile,
  boundary: AstBoundary,
  filePath: string,
  localName: string
): TextEdit[] | UnsupportedMigration {
  const edits: TextEdit[] = [];
  if (boundary.handler) {
    if (!isSafelyCallableRejectionHandler(boundary.handler)) {
      return unsupportedFinding(
        boundary.finding,
        'Promise catch handler is not a safely callable reference'
      );
    }
    const unavailableNames = allDeclaredNames(sourceFile);
    const errorName = uniqueName('error', unavailableNames);
    unavailableNames.add(errorName);
    const handlerName = uniqueName('handlerTelemetry', unavailableNames);
    const base = indentationAt(sourceText, boundary.diagnosticNode.getStart(sourceFile));
    const indent = `${base}  `;
    const handlerText = sourceText.slice(
      boundary.handler.getStart(sourceFile),
      boundary.handler.getEnd()
    );
    const lines = captureLines(
      localName,
      errorName,
      filePath,
      indent,
      requestContextBindings(boundary.diagnosticNode, sourceFile),
      boundary.diagnosticNode,
      sourceFile
    );
    return [
      {
        start: boundary.handler.getStart(sourceFile),
        end: boundary.handler.getEnd(),
        text: `(<HandlerResult,>(${handlerName}: ((error: never) => HandlerResult) | null | undefined) => (${errorName}: unknown): HandlerResult => {\n${indent}${lines.join('\n')}\n${indent}if (typeof ${handlerName} !== 'function') throw ${errorName};\n${indent}return Reflect.apply(${handlerName}, undefined, [${errorName}]) as HandlerResult;\n${base}})(${handlerText})`
      },
      ...rewrittenLineEndingEdits(sourceText, [
        boundary.diagnosticNode.getStart(sourceFile),
        boundary.handler.getEnd()
      ])
    ];
  }

  const body = boundary.body;
  if (!body) {
    return unsupportedFinding(boundary.finding, 'Promise catch boundary has no migratable body');
  }

  let errorName: string;
  let addedBinding = false;
  if (boundary.catchClause) {
    const declaration = boundary.catchClause.variableDeclaration;
    if (declaration) {
      const name = declaration.name;
      if (!ts.isIdentifier(name)) {
        return unsupportedFinding(boundary.finding, 'catch clause must use an identifier binding');
      }
      errorName = name.text;
    } else {
      errorName = uniqueName('error', identifierNamesWithin(boundary.catchClause.block));
      addedBinding = true;
      edits.push({
        start: boundary.catchClause.getStart(sourceFile) + 'catch'.length,
        end: boundary.catchClause.getStart(sourceFile) + 'catch'.length,
        text: ` (${errorName})`
      });
    }
  } else if (boundary.callback) {
    const parameter = boundary.callback.parameters[0];
    if (parameter) {
      const name = parameter.name;
      if (!ts.isIdentifier(name)) {
        return {
          path: boundary.finding.path,
          line: boundary.finding.line,
          column: boundary.finding.column,
          reason: 'Promise catch callback must use an identifier binding'
        };
      }
      if (parameter.dotDotDotToken || parameter.initializer) {
        return {
          path: boundary.finding.path,
          line: boundary.finding.line,
          column: boundary.finding.column,
          reason: 'Promise catch callback must use a plain identifier binding'
        };
      }
      errorName = name.text;
    } else {
      errorName = uniqueName('error', identifierNamesWithin(boundary.callback.body));
      addedBinding = true;
      const bindingEdit = callbackBindingEdit(boundary.callback, errorName);
      if (bindingEdit) edits.push(bindingEdit);
    }
  } else {
    throw new Error('Unsupported telemetry boundary');
  }

  if (addedBinding) {
    edits.push(...replacementErrorCauseEdits(body, errorName));
  }

  if (ts.isBlock(body)) {
    edits.push(
      blockCaptureEdit(
        sourceText,
        body,
        localName,
        errorName,
        filePath,
        requestContextBindings(boundary.diagnosticNode, sourceFile),
        boundary.diagnosticNode,
        sourceFile
      )
    );
  } else {
    const base = indentationAt(sourceText, boundary.callback!.getStart(sourceFile));
    const indent = `${base}  `;
    const expression = sourceText.slice(body.getStart(sourceFile), body.getEnd());
    const lines = captureLines(
      localName,
      errorName,
      filePath,
      indent,
      requestContextBindings(boundary.diagnosticNode, sourceFile),
      boundary.diagnosticNode,
      sourceFile
    );
    edits.push({
      start: body.getStart(sourceFile),
      end: body.getEnd(),
      text: `{\n${indent}${lines.join('\n')}\n${indent}return ${expression};\n${base}}`
    });
  }
  return [
    ...edits,
    ...rewrittenLineEndingEdits(sourceText, [
      boundary.diagnosticNode.getStart(sourceFile),
      body.getEnd()
    ])
  ];
}

export function migrateSource(sourceText: string, filePath: string): MigrationResult {
  if (isExcludedPath(filePath)) {
    return { changed: false, migratedBoundaries: 0, sourceText };
  }
  const initialParseErrors = parseDiagnostics(sourceFileFor(sourceText, filePath), filePath);
  if (initialParseErrors.length > 0) {
    return {
      changed: false,
      migratedBoundaries: 0,
      sourceText,
      unsupported: initialParseErrors
    };
  }
  let migratedSource = sourceText;
  let migratedBoundaries = 0;
  let unsupported: UnsupportedMigration[] = [];
  const seenOutputs = new Set([sourceText]);
  for (;;) {
    const findings = scanSource(migratedSource, filePath);
    if (findings.length === 0) break;
    const sourceFile = sourceFileFor(migratedSource, filePath);
    const boundaries = astBoundaries(sourceFile, findings);
    let migrated = false;
    const failed = new Map<string, UnsupportedMigration>();
    for (const boundary of boundaries) {
      const cleanupEdits =
        preemptingRethrowCaptureEdits(boundary, sourceFile, filePath) ??
        preemptingWrapperEdits(migratedSource, sourceFile, boundary, filePath);
      if (cleanupEdits && isUnsupportedMigration(cleanupEdits)) {
        failed.set(findingKey(boundary.finding), cleanupEdits);
        continue;
      }
      if (cleanupEdits) {
        const candidate = applyEdits(migratedSource, cleanupEdits as TextEdit[]);
        const candidateParseErrors = parseDiagnostics(sourceFileFor(candidate, filePath), filePath);
        if (candidateParseErrors.length > 0) {
          failed.set(findingKey(boundary.finding), candidateParseErrors[0]);
          continue;
        }
        const remaining = scanSource(candidate, filePath);
        if (
          candidate !== migratedSource &&
          !seenOutputs.has(candidate) &&
          remaining.length < findings.length
        ) {
          migratedSource = candidate;
          seenOutputs.add(candidate);
          migratedBoundaries += 1;
          migrated = true;
          break;
        }
      }
      if (
        runtimeFamily(filePath) === 'node' &&
        isMixedProviderDatabaseBoundary(boundary.diagnosticNode, sourceFile)
      ) {
        failed.set(
          findingKey(boundary.finding),
          unsupportedFinding(
            boundary.finding,
            'mixed provider and database operations require manual phase attribution'
          )
        );
        continue;
      }
      if (
        boundary.callback &&
        ts.isFunctionExpression(boundary.callback) &&
        boundary.callback.asteriskToken
      ) {
        failed.set(
          findingKey(boundary.finding),
          unsupportedFinding(
            boundary.finding,
            'generator Promise rejection callback does not execute its body'
          )
        );
        continue;
      }
      if (boundary.handler) {
        failed.set(
          findingKey(boundary.finding),
          unsupportedFinding(
            boundary.finding,
            isSafelyCallableRejectionHandler(boundary.handler)
              ? 'referenced Promise rejection handler may expose its rejection identity'
              : 'Promise catch handler is not a safely callable reference'
          )
        );
        continue;
      }
      if (functionCallbackUsesArguments(boundary)) {
        failed.set(
          findingKey(boundary.finding),
          unsupportedFinding(
            boundary.finding,
            'function rejection callback may expose its rejection via arguments'
          )
        );
        continue;
      }
      if (boundaryContainsDirectEval(boundary)) {
        failed.set(
          findingKey(boundary.finding),
          unsupportedFinding(
            boundary.finding,
            'direct eval may expose the caught identity and requires manual attribution'
          )
        );
        continue;
      }
      const facade = facadeBinding(sourceFile, filePath, boundary.diagnosticNode);
      const boundaryEdits = migrationEditsForBoundary(
        migratedSource,
        sourceFile,
        boundary,
        filePath,
        facade.localName
      );
      if (!Array.isArray(boundaryEdits)) {
        failed.set(findingKey(boundary.finding), boundaryEdits);
        continue;
      }
      const candidate = applyEdits(migratedSource, [
        ...boundaryEdits,
        ...(facade.importEdit ? [facade.importEdit] : [])
      ]);
      const candidateParseErrors = parseDiagnostics(sourceFileFor(candidate, filePath), filePath);
      if (candidateParseErrors.length > 0) {
        failed.set(findingKey(boundary.finding), candidateParseErrors[0]);
        continue;
      }
      if (candidate === migratedSource || seenOutputs.has(candidate)) {
        failed.set(
          findingKey(boundary.finding),
          unsupportedFinding(
            boundary.finding,
            'migration repeated output without covering the boundary'
          )
        );
        continue;
      }
      const remaining = scanSource(candidate, filePath);
      if (remaining.length >= findings.length) {
        failed.set(
          findingKey(boundary.finding),
          unsupportedFinding(
            boundary.finding,
            `migration did not reduce uncovered boundaries (${findings.length} -> ${remaining.length})`
          )
        );
        continue;
      }
      migratedSource = candidate;
      seenOutputs.add(candidate);
      migratedBoundaries += 1;
      migrated = true;
      break;
    }
    if (migrated) continue;
    unsupported = findings.map(
      (finding) =>
        failed.get(findingKey(finding)) ??
        unsupportedFinding(finding, 'scanner finding has no supported AST migration')
    );
    break;
  }
  const remaining = scanSource(migratedSource, filePath);
  if (remaining.length > 0 && unsupported.length === 0) {
    unsupported = remaining.map((finding) =>
      unsupportedFinding(finding, 'post-migration scan still reports the boundary')
    );
  }
  return {
    changed: migratedSource !== sourceText,
    migratedBoundaries,
    sourceText: migratedSource,
    ...(unsupported.length > 0 ? { unsupported } : {})
  };
}

export async function migrateFiles(
  filePaths: string[],
  options: { root?: string; write?: boolean; partial?: boolean } = {}
): Promise<{
  changedFiles: string[];
  migratedBoundaries: number;
  unsupported: UnsupportedMigration[];
}> {
  const root = path.resolve(options.root ?? process.cwd());
  const changedFiles: string[] = [];
  const unsupported: UnsupportedMigration[] = [];
  const pendingWrites: Array<{ absolute: string; sourceText: string }> = [];
  let migratedBoundaries = 0;
  for (const candidate of [...filePaths].sort()) {
    const absolute = path.resolve(candidate);
    const relative = normalizePath(path.relative(root, absolute));
    if (!isProductionSourcePath(relative, root)) continue;
    const sourceText = await readFile(absolute, 'utf8');
    const result = migrateSource(sourceText, relative);
    if (result.unsupported) unsupported.push(...result.unsupported);
    if (!result.changed) continue;
    changedFiles.push(relative);
    migratedBoundaries += result.migratedBoundaries;
    pendingWrites.push({ absolute, sourceText: result.sourceText });
  }
  if (options.write && unsupported.length > 0 && !options.partial) {
    return { changedFiles: [], migratedBoundaries: 0, unsupported };
  }
  if (options.write && (unsupported.length === 0 || options.partial)) {
    for (const pending of pendingWrites) {
      await writeFile(pending.absolute, pending.sourceText, 'utf8');
    }
  }
  return { changedFiles, migratedBoundaries, unsupported };
}

const opsFamilies = [
  'api',
  'processor',
  'notifier',
  'sql-worker',
  'config-agent',
  'collector',
  'web-server',
  'web-browser',
  'packages'
] as const;
type OpsFamily = (typeof opsFamilies)[number];

function requestedFamily(argumentsList: string[]): OpsFamily | undefined {
  const index = argumentsList.indexOf('--family');
  if (index < 0) return undefined;
  const value = argumentsList[index + 1];
  if (opsFamilies.some((family) => family === value)) return value as OpsFamily;
  throw new Error(`--family must be one of: ${opsFamilies.join(', ')}`);
}

function belongsToFamily(relative: string, family: OpsFamily | undefined): boolean {
  if (!family) return true;
  if (family === 'packages') return relative.startsWith('packages/');
  if (family === 'collector') return relative.startsWith('apps/web/src/server/collector/');
  if (family === 'web-browser') return relative.startsWith('apps/web/src/web/');
  if (family === 'web-server') {
    return (
      relative.startsWith('apps/web/src/') &&
      !relative.startsWith('apps/web/src/web/') &&
      !relative.startsWith('apps/web/src/server/collector/')
    );
  }
  return relative.startsWith(`apps/${family}/src/`);
}

async function main(): Promise<void> {
  const root = process.cwd();
  const argumentsList = process.argv.slice(2);
  const write = argumentsList.includes('--write');
  const partial = argumentsList.includes('--partial');
  const family = requestedFamily(argumentsList);
  const allFiles = await productionSourceFiles(root);
  const files = allFiles.filter((filePath) => {
    const relative = normalizePath(path.relative(root, filePath));
    return belongsToFamily(relative, family);
  });
  const result = await migrateFiles(files, { root, write, partial });
  for (const filePath of result.changedFiles) console.log(filePath);
  for (const item of result.unsupported) {
    console.error(`${item.path}:${item.line}:${item.column} ${item.reason}`);
  }
  console.log(
    `${write ? 'Migrated' : 'Would migrate'} ${result.migratedBoundaries} boundaries in ${result.changedFiles.length} files`
  );
  if (result.unsupported.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
