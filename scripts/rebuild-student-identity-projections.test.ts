import { describe, expect, it } from 'vitest';
import {
  RebuildStudentIdentityProjectionsUsageError,
  parseRebuildStudentIdentityProjectionsArgs,
} from './rebuild-student-identity-projections.js';

describe('parseRebuildStudentIdentityProjectionsArgs', () => {
  it('requires --run-id', () => {
    expect(() => parseRebuildStudentIdentityProjectionsArgs(['--output', 'scratch.json'])).toThrow(
      '--run-id is required'
    );
  });

  it('requires --output for a dry run', () => {
    expect(() => parseRebuildStudentIdentityProjectionsArgs(['--run-id', 'run-1'])).toThrow(
      '--output FILE is required for a dry run'
    );
  });

  it('requires confirmation for --apply', () => {
    expect(() => parseRebuildStudentIdentityProjectionsArgs(['--apply', '--run-id', 'run-1'])).toThrow(
      '--apply requires --confirm-project-id and --confirm-database-id'
    );
  });

  it('parses valid args', () => {
    const opts = parseRebuildStudentIdentityProjectionsArgs([
      '--apply',
      '--run-id',
      'run-1',
      '--confirm-project-id',
      'demo',
      '--confirm-database-id',
      '(default)',
      '--output',
      'scratch.json',
      '--mode',
      'custom',
    ]);
    expect(opts).toMatchObject({
      apply: true,
      runId: 'run-1',
      confirmProjectId: 'demo',
      confirmDatabaseId: '(default)',
      outputPath: 'scratch.json',
      mode: 'custom',
    });
  });

  it('rejects unknown flag', () => {
    expect(() => parseRebuildStudentIdentityProjectionsArgs(['--unknown'])).toThrow(
      'Unknown flag: --unknown'
    );
  });

  it('rejects repeated flag', () => {
    expect(() => parseRebuildStudentIdentityProjectionsArgs(['--run-id', '1', '--run-id', '2'])).toThrow(
      'Repeated flag: --run-id'
    );
  });

  it('rejects missing value', () => {
    expect(() => parseRebuildStudentIdentityProjectionsArgs(['--run-id'])).toThrow(
      'Missing value for --run-id'
    );
  });
});
