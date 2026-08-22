import {
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual
} from 'node:crypto';

export type OpsRole = 'ops_viewer' | 'ops_maintainer' | 'ops_owner';

export type OpsPermission =
  | 'health:read'
  | 'issues:read'
  | 'issues:write'
  | 'audit:read'
  | 'sql:read'
  | 'sql:workspace'
  | 'accounts:write'
  | 'alerts:write'
  | 'audit:anchor';

const rolePermissions: Readonly<Record<OpsRole, readonly OpsPermission[]>> = {
  ops_viewer: ['health:read', 'issues:read', 'audit:read'],
  ops_maintainer: [
    'health:read',
    'issues:read',
    'issues:write',
    'audit:read',
    'sql:read',
    'sql:workspace'
  ],
  ops_owner: [
    'health:read',
    'issues:read',
    'issues:write',
    'audit:read',
    'sql:read',
    'sql:workspace',
    'accounts:write',
    'alerts:write',
    'audit:anchor'
  ]
};

export function issueSession(
  input: {
    now?: Date;
    randomBytes?: (size: number) => Buffer;
  } = {}
): {
  token: string;
  csrfSecret: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
} {
  const now = input.now ?? new Date();
  const randomBytes = input.randomBytes ?? nodeRandomBytes;

  return {
    token: randomBytes(48).toString('base64url'),
    csrfSecret: randomBytes(32).toString('base64url'),
    idleExpiresAt: new Date(now.getTime() + 30 * 60 * 1_000).toISOString(),
    absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1_000).toISOString()
  };
}

export function hashSessionToken(token: string, pepper: string): string {
  if (!token || !pepper) {
    throw new Error('Session token and pepper are required');
  }

  return createHash('sha256').update(`${token}${pepper}`, 'utf8').digest('hex');
}

export function createCsrfToken(input: { sessionId: string; csrfSecret: string }): string {
  return createHmac('sha256', input.csrfSecret).update(input.sessionId, 'utf8').digest('base64url');
}

export function verifyCsrfToken(input: {
  sessionId: string;
  csrfSecret: string;
  csrfToken: string;
}): boolean {
  const expected = Buffer.from(createCsrfToken(input), 'utf8');
  const actual = Buffer.from(input.csrfToken, 'utf8');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertPermission(role: OpsRole, permission: OpsPermission): void {
  if (!rolePermissions[role].includes(permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }
}

export function isSqlElevationActive(
  elevation: { grantedAt: string; expiresAt: string },
  now = new Date()
): boolean {
  const grantedAt = Date.parse(elevation.grantedAt);
  const expiresAt = Date.parse(elevation.expiresAt);
  const maximumElevationLifetime = 30 * 60 * 1_000;

  return (
    Number.isFinite(grantedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt - grantedAt <= maximumElevationLifetime &&
    now.getTime() >= grantedAt &&
    now.getTime() < expiresAt
  );
}
