export type MonitorName =
  | 'app_liveness'
  | 'app_health'
  | 'app_process'
  | 'postgres'
  | 'errors'
  | 'cron'
  | 'backup'
  | 'collector';

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
  recipientId: string;
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
