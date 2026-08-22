import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schemaPath = resolve(process.cwd(), 'db/drizzle/schema.ts');
const malformedEmptyDefault = ".default(').notNull()";
const validEmptyDefault = ".default('').notNull()";

const source = readFileSync(schemaPath, 'utf8');
const correctionCount = source.split(malformedEmptyDefault).length - 1;
const normalized = source.replaceAll(malformedEmptyDefault, validEmptyDefault);

if (normalized.includes(".default(')")) {
  throw new Error(
    'Drizzle generated another malformed string default that the normalizer does not understand.'
  );
}

if (normalized !== source) {
  writeFileSync(schemaPath, normalized, 'utf8');
}

console.log(`Drizzle schema normalized (${correctionCount} empty-string defaults corrected).`);
