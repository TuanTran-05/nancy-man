export type DatabaseIdentity = {
  hostId: string;
  database: string;
  systemId: string;
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function assertIsolatedTarget(
  production: DatabaseIdentity,
  target: DatabaseIdentity,
  allowedTargetHostIds: readonly string[]
): void {
  if (normalized(target.hostId) === normalized(production.hostId)) {
    throw new Error('Recovery target must not be the production host');
  }

  if (normalized(target.database) === normalized(production.database)) {
    throw new Error('Recovery target must not be the production database');
  }

  if (!normalized(target.database).startsWith('edutrack_recovery_')) {
    throw new Error('Recovery target database must start with edutrack_recovery_');
  }

  const allowedHosts = new Set(allowedTargetHostIds.map(normalized));
  if (!allowedHosts.has(normalized(target.hostId))) {
    throw new Error('Recovery target host is not in the configured allowlist');
  }
}
