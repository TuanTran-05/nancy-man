import { describe, expect, it } from 'vitest';

import { readSqlWorkerRuntimeConfig } from './runtimeConfig.js';

const disabledEnvironment = {
  OPS_SECRET_DIRECTORY: '/run/credentials/edutrack-ops-sql-worker.service',
  OPS_SQL_SOCKET_PATH: '/run/edutrack-ops/sql-worker.sock',
  OPS_SQL_WORKER_HMAC_REFERENCE: 'ops-sql-worker-hmac',
  OPS_SQL_READ_ENABLED: 'false'
};

describe('readSqlWorkerRuntimeConfig', () => {
  it('starts a private worker without any production database credential while reads are disabled', () => {
    expect(readSqlWorkerRuntimeConfig(disabledEnvironment)).toEqual({
      secretDirectory: '/run/credentials/edutrack-ops-sql-worker.service',
      socketPath: '/run/edutrack-ops/sql-worker.sock',
      hmacSecretReference: 'ops-sql-worker-hmac',
      read: { enabled: false }
    });
  });

  it('requires a separately referenced, named read role before enabling production reads', () => {
    expect(
      readSqlWorkerRuntimeConfig({
        ...disabledEnvironment,
        OPS_SQL_READ_ENABLED: 'true',
        OPS_PRODUCTION_READ_DATABASE_URL_REFERENCE: 'production-read-database-url',
        OPS_PRODUCTION_READ_DATABASE_NAME: 'edutrack_production',
        OPS_PRODUCTION_READ_ROLE: 'ops_production_reader'
      })
    ).toEqual({
      secretDirectory: '/run/credentials/edutrack-ops-sql-worker.service',
      socketPath: '/run/edutrack-ops/sql-worker.sock',
      hmacSecretReference: 'ops-sql-worker-hmac',
      read: {
        enabled: true,
        databaseUrlReference: 'production-read-database-url',
        databaseName: 'edutrack_production',
        role: 'ops_production_reader'
      }
    });
  });

  it('refuses a raw production database URL in the worker environment', () => {
    expect(() =>
      readSqlWorkerRuntimeConfig({
        ...disabledEnvironment,
        OPS_PRODUCTION_READ_DATABASE_URL: 'postgresql://reader:secret@db/edutrack_production'
      })
    ).toThrow(/credential reference/i);
  });
});
