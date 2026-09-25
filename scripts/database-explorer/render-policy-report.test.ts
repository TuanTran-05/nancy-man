import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DATABASE_POLICY_VERSION } from '../../packages/security/src/database/columnPolicy.js';

const scriptPath = resolve(process.cwd(), 'scripts/database-explorer/render-policy-report.mjs');

describe('render-policy-report script', () => {
  it('renders table/column classifications from structural snapshot', () => {
    const validSnapshot = {
      targetId: 'edutrack_production',
      targetLabel: 'EduTrack Production',
      checksum: '1234567890abcdef'.repeat(4),
      policyVersion: DATABASE_POLICY_VERSION,
      edges: [],
      schemas: [
        {
          name: 'public',
          relations: [
            {
              name: 'students',
              kind: 'table',
              columns: [
                { name: 'id', dataType: 'uuid' },
                { name: 'email', dataType: 'text' },
                { name: 'password_hash', dataType: 'text' }
              ]
            }
          ]
        }
      ]
    };

    const run = spawnSync('node', [scriptPath], {
      input: JSON.stringify(validSnapshot),
      encoding: 'utf-8'
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('edutrack_production');
    expect(run.stdout).toContain('public.students.id: internal');
    expect(run.stdout).toContain('public.students.email: pii');
    expect(run.stdout).toContain('public.students.password_hash: blocked');
    expect(run.stdout).toContain(validSnapshot.checksum);
  });

  it('supports a structural snapshot file and confirms that its target matches', async () => {
    const validSnapshot = {
      targetId: 'edutrack_production',
      targetLabel: 'EduTrack Production',
      checksum: '1234567890abcdef'.repeat(4),
      policyVersion: DATABASE_POLICY_VERSION,
      edges: [],
      schemas: [
        {
          name: 'public',
          relations: [
            {
              name: 'students',
              kind: 'table',
              columns: [{ name: 'email', dataType: 'text' }]
            }
          ]
        }
      ]
    };
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-policy-'));
    try {
      const snapshotPath = join(directory, 'schema.json');
      await writeFile(snapshotPath, `${JSON.stringify(validSnapshot)}\n`, 'utf8');
      const run = spawnSync(
        'node',
        [scriptPath, '--snapshot-file', snapshotPath, '--target', 'edutrack_production'],
        { encoding: 'utf-8' }
      );

      expect(run.status).toBe(0);
      expect(run.stdout).toContain('Checksum:');
      expect(run.stdout).toContain('public.students.email: pii');
      expect(run.stdout).not.toContain('dataType');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects empty input and row payload fields without echoing sample values', () => {
    const empty = spawnSync('node', [scriptPath], { input: '', encoding: 'utf-8' });
    expect(empty.status).not.toBe(0);

    const rowPayloads = ['rows', 'cells', 'rowRefs'];
    for (const field of rowPayloads) {
      const dirtySnapshot = {
        targetId: 'edutrack_production',
        targetLabel: 'EduTrack Production',
        checksum: '1234567890abcdef'.repeat(4),
        policyVersion: DATABASE_POLICY_VERSION,
        edges: [],
        schemas: [
          {
            name: 'public',
            relations: [
              {
                name: 'students',
                kind: 'table',
                columns: [{ name: 'email', dataType: 'text' }],
                [field]: [{ email: 'LEAKED_ROW_VALUE_DO_NOT_PRINT' }]
              }
            ]
          }
        ]
      };

      const run = spawnSync('node', [scriptPath], {
        input: JSON.stringify(dirtySnapshot),
        encoding: 'utf-8'
      });

      expect(run.status, `${field} payload should be rejected`).not.toBe(0);
      expect(run.stdout + run.stderr).not.toContain('LEAKED_ROW_VALUE_DO_NOT_PRINT');
    }
  });
});
