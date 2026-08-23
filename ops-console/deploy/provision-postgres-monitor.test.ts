import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

const sqlPath = resolve(process.cwd(), 'deploy/provision-postgres-monitor.sql');
const scriptPath = resolve(process.cwd(), 'deploy/provision-postgres-monitor.sh');

describe('PostgreSQL metric provisioning policy', () => {
  it('exposes only execute on the fixed aggregate function', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION ops_metrics.snapshot() TO ops_monitor');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = pg_catalog');
    expect(sql).not.toMatch(/pg_monitor|GRANT\s+SELECT\s+ON\s+ALL\s+TABLES|EXECUTE\s+IMMEDIATE/i);
    const functionBody = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'), sql.indexOf('ALTER FUNCTION'));
    expect(functionBody).not.toMatch(/pg_stat_activity\.query|query\s*text|password/i);
  });

  it('keeps provisioning root-only and reads a mode-600 password file', () => {
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain('id -u');
    expect(script).toContain('OPS_MONITOR_PASSWORD_FILE');
    expect(script).toContain("stat -c '%a'");
    expect(script).toContain('runuser -u postgres -- psql');
    expect(script).not.toMatch(/set -x|echo\s+.*password|echo\s+.*DATABASE_URL/i);
  });

  it('creates the fixed function before revoking its public privileges', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    const createIndex = sql.indexOf('CREATE OR REPLACE FUNCTION ops_metrics.snapshot()');
    const revokeIndex = sql.indexOf('REVOKE ALL ON FUNCTION ops_metrics.snapshot() FROM PUBLIC');
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeGreaterThan(createIndex);
  });
});
