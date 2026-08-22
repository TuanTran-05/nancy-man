export type SqlWorkerActor = {
  userId: string;
  sessionId: string;
  role: 'ops_viewer' | 'ops_maintainer' | 'ops_owner';
};

export type WorkerCommand = {
  protocolVersion: 1;
  commandId: string;
  issuedAt: string;
  nonce: string;
  actor: SqlWorkerActor;
  kind: 'schema.read' | 'sql.classify' | 'sql.classifyMutation' | 'sql.previewRead' | 'sql.cancel';
  payload: unknown;
  signature: string;
};
export type WorkerResponse =
  | { protocolVersion: 1; commandId: string; ok: true; result: unknown }
  | {
      protocolVersion: 1;
      commandId: string;
      ok: false;
      error: { code: string; safeMessage: string; eventId?: string };
    };
