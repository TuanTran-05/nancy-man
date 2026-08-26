export type DrConfig = {
  productionHostId: string;
  backupHostId: string;
  standbyHostId: string;
  isolatedRestoreHostId: string;
  stanza: 'edutrack';
  archiveTimeoutSeconds: number;
  retentionDays: number;
  rpoTargetSeconds: 60;
  rtoTargetSeconds: 900;
};

type DrHostIdentities = Pick<
  DrConfig,
  'productionHostId' | 'backupHostId' | 'standbyHostId' | 'isolatedRestoreHostId'
>;

type DrEnvironment = Record<string, string | undefined>;

type RequiredEnvironmentKey =
  | 'OPS_DR_PRODUCTION_HOST_ID'
  | 'OPS_DR_BACKUP_HOST_ID'
  | 'OPS_DR_STANDBY_HOST_ID'
  | 'OPS_DR_ISOLATED_RESTORE_HOST_ID'
  | 'OPS_DR_STANZA'
  | 'OPS_DR_ARCHIVE_TIMEOUT_SECONDS'
  | 'OPS_DR_RETENTION_DAYS';

function readRequired(environment: DrEnvironment, key: RequiredEnvironmentKey): string {
  const value = environment[key]?.trim();

  if (!value) {
    throw new Error(`Missing required DR configuration: ${key}`);
  }

  return value;
}

function readWholeNumber(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a whole number`);
  }

  return Number(value);
}

export function assertDistinctRecoveryTargets(hosts: DrHostIdentities): void {
  const entries = Object.entries(hosts) as Array<[keyof DrHostIdentities, string]>;
  const seen = new Map<string, keyof DrHostIdentities>();

  for (const [field, rawHostId] of entries) {
    const hostId = rawHostId.trim();

    if (!hostId) {
      throw new Error(`${field} must not be empty`);
    }

    const existingField = seen.get(hostId);
    if (existingField) {
      throw new Error(`DR host identities must be distinct: ${existingField} and ${field}`);
    }

    seen.set(hostId, field);
  }
}

export function readDrConfig(environment: DrEnvironment): DrConfig {
  const config: DrConfig = {
    productionHostId: readRequired(environment, 'OPS_DR_PRODUCTION_HOST_ID'),
    backupHostId: readRequired(environment, 'OPS_DR_BACKUP_HOST_ID'),
    standbyHostId: readRequired(environment, 'OPS_DR_STANDBY_HOST_ID'),
    isolatedRestoreHostId: readRequired(environment, 'OPS_DR_ISOLATED_RESTORE_HOST_ID'),
    stanza: readRequired(environment, 'OPS_DR_STANZA') as DrConfig['stanza'],
    archiveTimeoutSeconds: readWholeNumber(
      readRequired(environment, 'OPS_DR_ARCHIVE_TIMEOUT_SECONDS'),
      'OPS_DR_ARCHIVE_TIMEOUT_SECONDS'
    ),
    retentionDays: readWholeNumber(
      readRequired(environment, 'OPS_DR_RETENTION_DAYS'),
      'OPS_DR_RETENTION_DAYS'
    ),
    rpoTargetSeconds: 60,
    rtoTargetSeconds: 900
  };

  assertDistinctRecoveryTargets({
    productionHostId: config.productionHostId,
    backupHostId: config.backupHostId,
    standbyHostId: config.standbyHostId,
    isolatedRestoreHostId: config.isolatedRestoreHostId
  });

  if (config.stanza !== 'edutrack') {
    throw new Error('OPS_DR_STANZA must be edutrack');
  }

  if (config.archiveTimeoutSeconds < 1 || config.archiveTimeoutSeconds > 60) {
    throw new Error('Archive timeout must be between 1 and 60 seconds');
  }

  if (config.retentionDays < 35) {
    throw new Error('Retention days must be at least 35');
  }

  return Object.freeze(config);
}
