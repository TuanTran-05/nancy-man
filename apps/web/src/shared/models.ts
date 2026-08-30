export type MonitorName =
  | 'app_liveness'
  | 'app_health'
  | 'app_process'
  | 'postgres'
  | 'errors'
  | 'cron'
  | 'backup'
  | 'collector'
  | 'beszel'
  | 'host_resources'
  | 'host_services';

export type InfrastructureServiceState =
  | 'active'
  | 'inactive'
  | 'failed'
  | 'activating'
  | 'deactivating'
  | 'reloading';
export type InfrastructureServiceSubState = 'dead' | 'running' | 'exited' | 'failed' | 'unknown';

export type MonitorLevel = 'unknown' | 'healthy' | 'warning' | 'critical';

export type IncidentState = 'open' | 'acknowledged' | 'recovered';

export interface MonitorSample {
  monitor: MonitorName;
  level: MonitorLevel;
  observedAt: string;
  latencyMs: number | null;
  details: Record<string, unknown>;
  errorCode: string | null;
}

export interface Incident {
  id: string;
  dedupeKey: string;
  monitor: MonitorName;
  level: Exclude<MonitorLevel, 'unknown' | 'healthy'>;
  state: IncidentState;
  occurrenceCount: number;
  openedAt: string;
  lastSeenAt: string;
  recoveredAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  note: string | null;
  safeSummary: string;
}

export interface AlertDelivery {
  id: string;
  incidentId: string;
  kind: 'opened' | 'reminder' | 'recovered' | 'collector_failed';
  state: 'queued' | 'sending' | 'sent' | 'failed' | 'delivery_ambiguous';
  attemptCount: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
}

export interface DashboardOverview {
  collectedAt: string | null;
  latestByMonitor: Partial<Record<MonitorName, MonitorSample>>;
  openIncidents: Incident[];
  recentDeliveries: AlertDelivery[];
}

export type InfrastructureHistoryRange = '1h' | '24h' | '7d' | '30d';
export type InfrastructureHistoryResolution = 60 | 300 | 1800 | 7200;

export interface InfrastructureHistoryPoint {
  observedAt: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  load1: number | null;
  networkReceiveBytesPerSecond: number | null;
  networkTransmitBytesPerSecond: number | null;
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
}

export interface InfrastructureHistoryResponse {
  range: InfrastructureHistoryRange;
  resolutionSeconds: InfrastructureHistoryResolution;
  collectedAt: string;
  points: InfrastructureHistoryPoint[];
}
