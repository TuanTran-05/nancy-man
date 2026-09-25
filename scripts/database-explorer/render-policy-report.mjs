#!/usr/bin/env node
/* global console */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { isDatabaseTargetId } from '../../packages/contracts/src/databaseExplorer.ts';
import { classifyColumn, DATABASE_POLICY_VERSION } from '../../packages/security/src/database/columnPolicy.ts';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsRowValues(value) {
  if (Array.isArray(value)) return value.some(containsRowValues);
  if (!isRecord(value)) return false;

  for (const [key, nested] of Object.entries(value)) {
    if (['rows', 'cells', 'rowref', 'rowrefs'].includes(key.toLowerCase())) return true;
    if (containsRowValues(nested)) return true;
  }
  return false;
}

function parseArguments(argumentsList) {
  const values = new Map();
  const allowed = new Set(['--snapshot-file', '--target']);
  for (let index = 0; index < argumentsList.length; index++) {
    const flag = argumentsList[index];
    if (!flag || !allowed.has(flag) || values.has(flag)) throw new Error('ARGUMENTS_INVALID');
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) throw new Error('ARGUMENTS_INVALID');
    values.set(flag, value);
    index++;
  }

  const target = values.get('--target');
  if (target !== undefined && !isDatabaseTargetId(target)) throw new Error('TARGET_INVALID');
  return { snapshotFile: values.get('--snapshot-file'), target };
}

function validateSnapshot(value) {
  if (!isRecord(value) || containsRowValues(value)) {
    throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
  }
  if (
    !isDatabaseTargetId(value.targetId) ||
    typeof value.targetLabel !== 'string' ||
    typeof value.checksum !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.checksum) ||
    value.policyVersion !== DATABASE_POLICY_VERSION ||
    !Array.isArray(value.schemas) ||
    !Array.isArray(value.edges)
  ) {
    throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
  }

  for (const schema of value.schemas) {
    if (!isRecord(schema) || typeof schema.name !== 'string' || !Array.isArray(schema.relations)) {
      throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
    }
    for (const relation of schema.relations) {
      if (
        !isRecord(relation) ||
        typeof relation.name !== 'string' ||
        !Array.isArray(relation.columns)
      ) {
        throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
      }
      for (const column of relation.columns) {
        if (!isRecord(column) || typeof column.name !== 'string') {
          throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
        }
      }
    }
  }
  return value;
}

function readSnapshot(snapshotFile) {
  let input;
  try {
    input = snapshotFile ? readFileSync(snapshotFile, 'utf8') : readFileSync(0, 'utf8');
  } catch {
    throw new Error('SNAPSHOT_FILE_INVALID');
  }
  if (!input.trim()) throw new Error('SNAPSHOT_EMPTY');
  try {
    return validateSnapshot(JSON.parse(input));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('STRUCTURAL_')) throw error;
    throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  const snapshot = readSnapshot(options.snapshotFile);
  if (options.target && snapshot.targetId !== options.target) throw new Error('TARGET_MISMATCH');

  console.log(`Target: ${snapshot.targetId}`);
  console.log(`Checksum: ${snapshot.checksum}`);
  console.log('Columns:');

  for (const schema of snapshot.schemas) {
    for (const relation of schema.relations) {
      for (const column of relation.columns) {
        const classification = classifyColumn({
          targetId: snapshot.targetId,
          schema: schema.name,
          relation: relation.name,
          column: column.name
        });
        console.log(`${schema.name}.${relation.name}.${column.name}: ${classification}`);
      }
    }
  }
} catch (error) {
  const code = error instanceof Error ? error.message : 'STRUCTURAL_SNAPSHOT_INVALID';
  console.error(`Invalid structural snapshot: ${code}`);
  process.exitCode = 1;
}
