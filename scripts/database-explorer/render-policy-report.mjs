#!/usr/bin/env node
/* global console */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { classifyColumn } from '../../packages/security/src/database/columnPolicy.ts';

function checkForRowValues(obj) {
  if (!obj || typeof obj !== 'object') return false;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (checkForRowValues(item)) return true;
    }
    return false;
  }

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'rows' || lowerKey === 'rowref' || lowerKey === 'cells') {
      return true;
    }
    if (typeof value === 'object' && checkForRowValues(value)) {
      return true;
    }
  }

  return false;
}

try {
  const input = readFileSync(0, 'utf-8');
  if (!input.trim()) {
    console.error('Invalid structural snapshot: empty input');
    process.exit(1);
  }

  const snapshot = JSON.parse(input);

  if (checkForRowValues(snapshot)) {
    console.error('Row values forbidden: invalid structural snapshot');
    process.exit(1);
  }

  if (!snapshot.targetId || !snapshot.checksum || !Array.isArray(snapshot.schemas)) {
    console.error('Invalid structural snapshot: missing required fields');
    process.exit(1);
  }

  console.log(`Target: ${snapshot.targetId}`);
  console.log(`Checksum: ${snapshot.checksum}`);
  console.log('Columns:');

  for (const schema of snapshot.schemas) {
    if (!schema || !Array.isArray(schema.relations)) continue;
    for (const relation of schema.relations) {
      if (!relation || !Array.isArray(relation.columns)) continue;
      for (const column of relation.columns) {
        if (!column || !column.name) continue;
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
} catch (err) {
  console.error(`Invalid structural snapshot: ${err.message}`);
  process.exit(1);
}
