import { describe, expect, it, vi } from 'vitest';
import { createPostgresContractClient } from './postgresContractTarget.js';

describe('isolated PostgreSQL contract target', () => {
  it('does not enable or construct a client from OPS_MONITOR_DATABASE_URL alone', () => {
    const factory = vi.fn((connectionString: string) => ({ connectionString }));
    expect(
      createPostgresContractClient(
        { OPS_MONITOR_DATABASE_URL: 'postgres://monitor@127.0.0.1/edutrack_test' },
        factory
      )
    ).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed', 'not a database URL', undefined],
    ['remote host', 'postgres://contract@database.internal/edutrack_ops_test', undefined],
    ['production identity', 'postgres://contract@127.0.0.1/edutrack', undefined],
    [
      'production-marked test identity',
      'postgres://contract@127.0.0.1/edutrack_prod_test',
      undefined
    ],
    [
      'connection-parameter host override',
      'postgres://contract@127.0.0.1/edutrack_test?host=database.internal',
      undefined
    ],
    [
      'runtime identity',
      'postgres://contract@127.0.0.1/edutrack_ops_test',
      'postgres://contract@127.0.0.1/edutrack_ops_test'
    ]
  ])('rejects %s before client construction', (_label, dedicatedUrl, runtimeUrl) => {
    const factory = vi.fn((connectionString: string) => ({ connectionString }));
    expect(() =>
      createPostgresContractClient(
        {
          OPS_TEST_DATABASE_URL: dedicatedUrl,
          ...(runtimeUrl ? { OPS_MONITOR_DATABASE_URL: runtimeUrl } : {})
        },
        factory
      )
    ).toThrow(/OPS_TEST_DATABASE_URL/u);
    expect(factory).not.toHaveBeenCalled();
  });

  it('constructs exactly one client for a loopback unmistakable test database', () => {
    const factory = vi.fn((connectionString: string) => ({ connectionString }));
    const connectionString = 'postgres://contract@127.0.0.1:55432/edutrack_ops_contract_test';
    expect(
      createPostgresContractClient({ OPS_TEST_DATABASE_URL: connectionString }, factory)
    ).toEqual({ connectionString });
    expect(factory).toHaveBeenCalledOnce();
  });
});
