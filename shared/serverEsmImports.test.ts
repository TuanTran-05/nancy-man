import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_RUNTIME_ROOTS = ['api', 'shared'];
const ALLOWED_RUNTIME_EXTENSIONS = /\.(js|json|css|svg|png|jpg|jpeg|webp|gif|wasm)$/;
const statementStartPattern = /^\s*(?:import|export)\b/;
const typeOnlyStatementPattern = /^\s*(?:import|export)\s+type\b/;
const relativeImportPatterns = [
  /^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/,
  /\b(?:import|export)\s+(?!type\b)[\s\S]*?\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/,
];
const dynamicImportPattern = /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function listProductionServerFiles(): string[] {
  return SERVER_RUNTIME_ROOTS.flatMap((root) => listFiles(join(process.cwd(), root)))
    .filter((filePath) => filePath.endsWith('.ts'))
    .filter((filePath) => !filePath.endsWith('.test.ts'))
    .filter((filePath) => !filePath.endsWith('.d.ts'))
    .sort();
}

function toRepoPath(filePath: string): string {
  return relative(process.cwd(), filePath).replace(/\\/g, '/');
}

function listRuntimeRelativeImports(source: string): string[] {
  const specifiers: string[] = [];
  let statement = '';

  const checkStatement = (value: string) => {
    if (typeOnlyStatementPattern.test(value)) return;
    relativeImportPatterns.forEach((pattern) => {
      const match = value.match(pattern);
      if (match?.[1]) specifiers.push(match[1]);
    });
  };

  source.split(/\r?\n/).forEach((line) => {
    [...line.matchAll(dynamicImportPattern)].forEach((match) => {
      if (match[1]) specifiers.push(match[1]);
    });

    if (statement) {
      statement += `\n${line}`;
      if (/;\s*$/.test(line)) {
        checkStatement(statement);
        statement = '';
      }
      return;
    }

    if (statementStartPattern.test(line)) {
      statement = line;
      if (/;\s*$/.test(line)) {
        checkStatement(statement);
        statement = '';
      }
    }
  });

  if (statement) checkStatement(statement);
  return [...new Set(specifiers)];
}

describe('server shared ESM imports', () => {
  it('uses explicit .js extensions for runtime relative imports', () => {
    const offenders = listProductionServerFiles().flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return listRuntimeRelativeImports(source)
        .filter((specifier) => !ALLOWED_RUNTIME_EXTENSIONS.test(specifier))
        .map((specifier) => `${toRepoPath(filePath)} imports ${specifier}`);
    });

    expect(offenders).toEqual([]);
  });
});
