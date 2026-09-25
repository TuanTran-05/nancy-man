import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const scriptPath = resolve(process.cwd(), 'scripts/database-explorer/render-policy-report.mjs');

describe('render-policy-report script', () => {
  it('renders table/column classifications from structural snapshot', () => {
    const validSnapshot = {
      targetId: 'edutrack_production',
      checksum: '1234567890abcdef'.repeat(4),
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

  it('rejects snapshots that contain row values or leaked data', () => {
    const dirtySnapshot = {
      targetId: 'edutrack_production',
      checksum: '1234567890abcdef'.repeat(4),
      schemas: [
        {
          name: 'public',
          relations: [
            {
              name: 'students',
              kind: 'table',
              columns: [{ name: 'email', dataType: 'text' }],
              rows: [{ email: 'leaked@example.com' }]
            }
          ]
        }
      ]
    };

    const run = spawnSync('node', [scriptPath], {
      input: JSON.stringify(dirtySnapshot),
      encoding: 'utf-8'
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/row values forbidden|invalid structural snapshot/i);
    expect(run.stdout).not.toContain('leaked@example.com');
  });
});
