export type TelemetrySource =
  | 'browser'
  | 'api'
  | 'database'
  | 'document_store'
  | 'job'
  | 'provider'
  | 'process'
  | 'deployment'
  | 'synthetic';

export type TelemetryEnvelopeV1 = {
  schemaVersion: 1;
  eventId: `EVT_${string}`;
  idempotencyKey: string;
  capturedAt: string;
  source: TelemetrySource;
  level: 'fatal' | 'error' | 'warning';
  error: {
    name: string;
    code: string;
    safeMessage: string;
    stack?: string;
    componentStack?: string;
  };
  context: {
    requestId?: `REQ_${string}`;
    traceId?: string;
    route?: string;
    release: string;
    service: string;
    environment: 'production';
    telemetryContextToken?: string;
    tags?: Record<string, string>;
    breadcrumbs?: Array<{ at: string; category: string; message: string }>;
  };
};

export type ErrorOccurrenceV1 = {
  eventId: `EVT_${string}`;
  issueId: `ISS_${string}`;
  receivedAt: string;
  source: TelemetrySource;
  errorCode: string;
  exceptionType: string;
  safeMessage: string;
  stackArtifactId?: string;
  requestId?: `REQ_${string}`;
  traceId?: string;
  release: string;
  service: string;
  route?: string;
  userRef?: string;
  userRole?: string;
  sessionHash?: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  tags: Record<string, string>;
};
