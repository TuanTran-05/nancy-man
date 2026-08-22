import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const loadtestRoot = new URL('../../../../loadtests/', import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')
);
const compressionScript = readFileSync(
  new URL('../../../../scripts/check-api-compression.mjs', import.meta.url),
  'utf8'
);

function readLoadtestFile(path: string): string {
  return readFileSync(new URL(path, loadtestRoot), 'utf8');
}

describe('k6 smoke and scenario scripts', () => {
  it('uses the installed TypeScript runner for loadtest setup', () => {
    expect(packageJson.scripts['loadtest:setup']).toBe('tsx loadtests/lib/auth.ts');
  });

  it('generates native session tokens from existing loadtest accounts', () => {
    const authScript = readLoadtestFile('lib/auth.ts');

    expect(authScript).toContain('/api/v1/auth/session-login');
    expect(authScript).toContain('edutrack_session');
    expect(authScript).not.toContain('createUser');
  });

  it('uses the real audit-log read channel in k6 checks', () => {
    expect(readLoadtestFile('endpoints/audit-logs.ts')).toContain('/api/v1/read/audit-log');
  });

  it('does not call the admin-only staff config endpoint anonymously', () => {
    for (const scenario of [
      'scenarios/smoke.ts',
      'scenarios/load.ts',
      'scenarios/stress.ts',
      'scenarios/soak.ts',
      'scenarios/scalability.ts',
    ]) {
      expect(readLoadtestFile(scenario), scenario).not.toMatch(/\bgetStaffConfig\(\s*\)/);
    }
  });

  it('marks intentional auth failures as expected k6 responses', () => {
    expect(readLoadtestFile('endpoints/staff-config.ts')).toContain('responseCallback');
    expect(readLoadtestFile('endpoints/verify-student-login.ts')).toContain('responseCallback');
  });

  it('tags every endpoint request so k6 endpoint thresholds receive samples', () => {
    const endpointTags: Record<string, string> = {
      'endpoints/health.ts': "endpoint: 'health'",
      'endpoints/staff-config.ts': "endpoint: 'staff-config'",
      'endpoints/verify-student-login.ts': "endpoint: 'verify-student-login'",
      'endpoints/finance-report.ts': "endpoint: 'finance-report'",
      'endpoints/audit-logs.ts': "endpoint: 'audit-logs'",
      'endpoints/receipt-post.ts': "endpoint: 'receipt-post'",
    };

    for (const [file, tag] of Object.entries(endpointTags)) {
      expect(readLoadtestFile(file), file).toContain(tag);
    }
  });

  it('requires admin-authenticated endpoints to return authorized statuses when a token is used', () => {
    expect(readLoadtestFile('endpoints/finance-report.ts')).not.toContain(
      'financeReportExpectedStatuses = http.expectedStatuses(200, 401, 403)'
    );
    expect(readLoadtestFile('endpoints/audit-logs.ts')).not.toContain(
      'auditLogsExpectedStatuses = http.expectedStatuses(200, 401, 403)'
    );
    expect(readLoadtestFile('endpoints/receipt-post.ts')).not.toContain(
      'receiptPostExpectedStatuses = http.expectedStatuses(200, 400, 401, 403, 404)'
    );
  });

  it('keeps smoke latency threshold aligned with production availability checks', () => {
    expect(readLoadtestFile('scenarios/smoke.ts')).toContain("http_req_duration: ['p(95)<5000']");
  });

  it('keeps load latency thresholds aligned with VPS production latency', () => {
    const loadScenario = readLoadtestFile('scenarios/load.ts');

    expect(loadScenario).toContain("http_req_duration: ['p(50)<700', 'p(95)<1500', 'p(99)<3000']");
    expect(loadScenario).toContain("'http_req_duration{endpoint:health}': ['p(95)<1000']");
  });

  it('keeps the load scenario read-model imports syntactically valid', () => {
    const loadScenario = readLoadtestFile('scenarios/load.ts');

    expect(loadScenario).toMatch(/import\s*\{\s*getFinanceLedgersPage/);
  });

  it('allows compression checks to hit authenticated API payloads', () => {
    expect(packageJson.scripts['check:api-compression']).toBe(
      'node scripts/check-api-compression.mjs'
    );
    expect(compressionScript).toContain('process.env.ADMIN_TOKEN');
    expect(compressionScript).toContain('Authorization');
    expect(compressionScript).toContain('Bearer ${token}');
  });
});
