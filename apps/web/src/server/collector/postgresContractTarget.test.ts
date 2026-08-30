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

  it.each([
    [
      'different userinfo and explicit default port',
      'postgres://contract@127.0.0.1:5432/edutrack_ops_test',
      'postgres://monitor@127.0.0.1/edutrack_ops_test'
    ],
    [
      'localhost and IPv4 loopback aliases',
      'postgres://contract@localhost:5432/edutrack_ops_test',
      'postgres://runtime@127.0.0.1/edutrack_ops_test'
    ],
    [
      'IPv6 loopback, protocol alias, and decoded database name',
      'postgresql://contract@[::1]/edutrack%5Fops%5Ftest',
      'postgres://runtime@localhost:5432/edutrack_ops_test'
    ],
    [
      'runtime query port override',
      'postgres://contract@localhost:55432/edutrack_ops_contract_test',
      'postgres://runtime@127.0.0.1/edutrack_ops_contract_test?port=55432'
    ],
    [
      'trailing-dot loopback alias',
      'postgres://contract@localhost:5432/edutrack_ops_contract_test',
      'postgres://runtime@localhost./edutrack_ops_contract_test'
    ]
  ])(
    'keeps an equivalent %s target disabled without constructing a client',
    (_label, dedicatedUrl, runtimeUrl) => {
      const factory = vi.fn((connectionString: string) => ({ connectionString }));

      expect(
        createPostgresContractClient(
          {
            OPS_TEST_DATABASE_URL: dedicatedUrl,
            OPS_MONITOR_DATABASE_URL: runtimeUrl
          },
          factory
        )
      ).toBeNull();
      expect(factory).not.toHaveBeenCalled();
    }
  );

  it('constructs exactly one client for a loopback unmistakable test database', () => {
    const factory = vi.fn((connectionString: string) => ({ connectionString }));
    const connectionString = 'postgres://contract@127.0.0.1:55432/edutrack_ops_contract_test';
    expect(
      createPostgresContractClient({ OPS_TEST_DATABASE_URL: connectionString }, factory)
    ).toEqual({ connectionString });
    expect(factory).toHaveBeenCalledOnce();
  });
});
