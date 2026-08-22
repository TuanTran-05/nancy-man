import { createHash } from 'node:crypto';
import ts from 'typescript';

/**
 * Stops the old identity model from coming back.
 *
 * Every rule here corresponds to a defect that already happened in this
 * codebase. Class promotion used to clone a profile, which is where the
 * fifty-nine doubly-owned codes came from. Rosters were read from
 * `students.classId`, a projection that goes stale the moment a student moves.
 * Recipients were selected by `users.classId`, and retirement deletes that
 * field. None of these produced an error when they were wrong; they produced a
 * wrong answer, quietly, for months.
 *
 * A scanner is the only thing that catches the *next* one. Review does not:
 * every one of these was written by somebody who had read the surrounding
 * code.
 *
 * **Exceptions are AST fingerprints, never line numbers or text.** A
 * line-number exception moves when somebody adds an import above it. A
 * text exception matches a string that means something different next month.
 * The fingerprint covers the node's normalized shape, so editing the code
 * invalidates the exception and forces a fresh look — which is the point.
 */

export type StudentIdentityArchitecturePolicy = 'pre-cutover' | 'post-retirement';

export type StudentIdentityArchitectureViolationCode =
  | 'ANONYMOUS_STUDENT_DOCUMENT_CREATE'
  | 'STUDENT_COLLECTION_ADD'
  | 'AUTHORITATIVE_PROFILE_CLASS_QUERY'
  | 'AUTHORITATIVE_LINKED_USER_CLASS_QUERY'
  | 'CLONE_BASED_CLASS_PROGRESSION'
  | 'PROFILE_PROMOTED_STATUS_WRITE'
  | 'LEGACY_PROJECTION_FIELD_WRITE'
  | 'LEGACY_CODE_FALLBACK'
  | 'LEGACY_SOFT_MERGE_POINTER_RESOLUTION'
  | 'AUTHORITATIVE_PRESENTATION_DEDUPE';

export type StudentIdentityArchitectureAllowlistEntry = {
  policy: 'pre-cutover';
  path: string;
  nodeKind: string;
  astFingerprint: string;
  reason:
    | 'compatibility_projection_writer'
    | 'legacy_compare'
    | 'anomaly_report'
    | 'reviewed_migration';
};

export type StudentIdentityArchitectureViolation = {
  code: StudentIdentityArchitectureViolationCode;
  path: string;
  line: number;
  nodeKind: string;
  astFingerprint: string;
  detail: string;
};

/**
 * Codes the post-retirement policy refuses outright.
 *
 * The pre-cutover policy allows these behind a reviewed fingerprint because
 * the compatibility layer still exists. Once retirement has removed the
 * fields, an exception would be describing code that reads something no longer
 * written — so the allowlist stops applying rather than being emptied by hand.
 */
const LEGACY_ONLY_CODES = new Set<StudentIdentityArchitectureViolationCode>([
  'AUTHORITATIVE_PROFILE_CLASS_QUERY',
  'AUTHORITATIVE_LINKED_USER_CLASS_QUERY',
  'LEGACY_PROJECTION_FIELD_WRITE',
  'LEGACY_CODE_FALLBACK',
  'LEGACY_SOFT_MERGE_POINTER_RESOLUTION',
  'AUTHORITATIVE_PRESENTATION_DEDUPE',
]);

const LEGACY_PROJECTION_FIELDS = new Set(['classId', 'teacherId', 'enrollmentStatus']);

/** DocumentStore methods that persist a payload. */
const WRITE_METHODS = new Set(['set', 'update', 'add', 'create']);

/** Identifiers whose spread into a written payload means a profile clone. */
const CLONE_SOURCE_NAMES = /^(studentData|studentDoc|profileData|existingStudent|sourceStudent)$/;
const LEGACY_DEDUPE_HELPERS = new Set([
  'getCurrentStudentRecords',
  'getCurrentStudentRoster',
  'getCurrentStudentHeadcount',
  'getCurrentClassStudentRecords',
  'countCurrentStudents',
]);

/**
 * A fingerprint of the node's shape, with identifier names kept and literal
 * text kept, but positions and trivia discarded.
 *
 * Positions are what make a line-number exception rot; trivia is what makes a
 * text exception survive a rename it should not have survived.
 */
function fingerprintNode(node: ts.Node): string {
  const parts: string[] = [];
  const walk = (current: ts.Node) => {
    parts.push(ts.SyntaxKind[current.kind]);
    if (ts.isIdentifier(current)) parts.push(current.text);
    if (ts.isStringLiteralLike(current)) parts.push(JSON.stringify(current.text));
    current.forEachChild(walk);
  };
  walk(node);
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  return ts.isStringLiteralLike(node) ? node.text : null;
}

/** The collection name a `.where(...)`/`.add(...)` chain is rooted at. */
function collectionNameOf(expression: ts.Expression): string | null {
  let current: ts.Node = expression;
  for (let depth = 0; depth < 12; depth += 1) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'collection') {
        const name = literalText(current.arguments[0]);
        if (name) return name;
      }
      current = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
      continue;
    }
    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    return null;
  }
  return null;
}

function objectWritesLegacyField(node: ts.ObjectLiteralExpression): string[] {
  const written: string[] = [];
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const name = property.name && ts.isIdentifier(property.name) ? property.name.text : null;
    const literal = property.name ? literalText(property.name) : null;
    const key = name ?? literal;
    if (key && LEGACY_PROJECTION_FIELDS.has(key)) written.push(key);
  }
  return written;
}

export type ScanInput = {
  policy: StudentIdentityArchitecturePolicy;
  files: Array<{ path: string; source: string }>;
  allowlist: readonly StudentIdentityArchitectureAllowlistEntry[];
};

export function scanStudentIdentityArchitecture(
  input: ScanInput
): StudentIdentityArchitectureViolation[] {
  const found: StudentIdentityArchitectureViolation[] = [];

  for (const file of input.files) {
    const source = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const report = (
      node: ts.Node,
      code: StudentIdentityArchitectureViolationCode,
      detail: string
    ) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push({
        code,
        path: file.path,
        line: line + 1,
        nodeKind: ts.SyntaxKind[node.kind],
        astFingerprint: fingerprintNode(node),
        detail,
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const collection = collectionNameOf(node.expression.expression);

        if (method === 'add' && collection === 'students') {
          // An auto-id profile is a profile nothing else can name, which is
          // how a second record for one child comes into existence.
          report(
            node,
            'STUDENT_COLLECTION_ADD',
            'students.add() creates a profile with an id nothing else can name'
          );
        }
        if (method === 'doc' && collection === 'students' && node.arguments.length === 0) {
          report(
            node,
            'ANONYMOUS_STUDENT_DOCUMENT_CREATE',
            'students.doc() with no id creates an anonymous profile'
          );
        }
        if (method === 'where' && literalText(node.arguments[0]) === 'classId') {
          if (collection === 'students') {
            report(
              node,
              'AUTHORITATIVE_PROFILE_CLASS_QUERY',
              'students.classId is a projection; class membership comes from enrollments'
            );
          }
          if (collection === 'users') {
            // The dangerous one. Retirement deletes this field, and its
            // readers return an empty set rather than an error.
            report(
              node,
              'AUTHORITATIVE_LINKED_USER_CLASS_QUERY',
              'users.classId is removed by retirement; its readers fail silently'
            );
          }
        }
      }

      if (ts.isIdentifier(node) && LEGACY_DEDUPE_HELPERS.has(node.text)) {
        const parent = node.parent;
        // Only a call counts. An import or a re-export is how the deprecated
        // helper stays reachable for anomaly reporting.
        if (parent && ts.isCallExpression(parent) && parent.expression === node) {
          report(
            node,
            'AUTHORITATIVE_PRESENTATION_DEDUPE',
            `${node.text} collapses physical rows by guessing at identity`
          );
        }
      }

      if (ts.isIdentifier(node) && node.text === 'allowLegacyCodeFallback') {
        report(
          node,
          'LEGACY_CODE_FALLBACK',
          'the legacy code fallback scans students.studentId and can return two owners'
        );
      }
      if (ts.isIdentifier(node) && node.text === 'mergedIntoStudentId') {
        report(
          node,
          'LEGACY_SOFT_MERGE_POINTER_RESOLUTION',
          'resolution through mergedIntoStudentId predates the alias record'
        );
      }

      // Only payloads actually handed to a DocumentStore write count. A rule that
      // flagged every object literal mentioning `classId` would report several
      // hundred type declarations, React props, and query parameters — and a
      // gate nobody can satisfy is a gate everybody learns to skip.
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (WRITE_METHODS.has(method)) {
          for (const argument of node.arguments) {
            let targetArg = argument;
            if (ts.isIdentifier(argument)) {
              const walk = (current: ts.Node) => {
                if (
                  ts.isVariableDeclaration(current) &&
                  ts.isIdentifier(current.name) &&
                  current.name.text === argument.text &&
                  current.initializer
                ) {
                  targetArg = current.initializer as ts.Expression;
                }
                current.forEachChild(walk);
              };
              walk(source);
            }

            if (!ts.isObjectLiteralExpression(targetArg)) continue;

            const written = objectWritesLegacyField(targetArg);
            if (written.length > 0) {
              report(
                targetArg,
                'LEGACY_PROJECTION_FIELD_WRITE',
                `writes the compatibility projection field(s) ${written.sort().join(', ')}`
              );
            }

            for (const property of targetArg.properties) {
              if (ts.isPropertyAssignment(property)) {
                const key =
                  property.name && ts.isIdentifier(property.name)
                    ? property.name.text
                    : literalText(property.name);
                if (
                  key === 'enrollmentStatus' &&
                  literalText(property.initializer) === 'promoted'
                ) {
                  // The status that made a promoted student look active on one
                  // row and promoted on another.
                  report(
                    property,
                    'PROFILE_PROMOTED_STATUS_WRITE',
                    'writes enrollmentStatus: promoted onto a profile'
                  );
                }
                continue;
              }
              if (
                ts.isSpreadAssignment(property) &&
                ts.isIdentifier(property.expression) &&
                CLONE_SOURCE_NAMES.test(property.expression.text)
              ) {
                // Copying a profile into a new document is exactly how
                // promotion used to create a second record for one child.
                report(
                  property,
                  'CLONE_BASED_CLASS_PROGRESSION',
                  `spreads ${property.expression.text} into a written document`
                );
              }
            }
          }
        }
      }

      node.forEachChild(visit);
    };

    visit(source);
  }

  const allowed = new Map(
    input.allowlist
      .filter((entry) => entry.policy === 'pre-cutover')
      .map((entry) => [`${entry.path}|${entry.nodeKind}|${entry.astFingerprint}`, entry])
  );

  return found.filter((violation) => {
    // Post-retirement ignores the allowlist for the legacy behaviours: an
    // exception there would describe code reading something no longer written.
    if (input.policy === 'post-retirement' && LEGACY_ONLY_CODES.has(violation.code)) return true;
    return !allowed.has(
      `${violation.path}|${violation.nodeKind}|${violation.astFingerprint}`
    );
  });
}
