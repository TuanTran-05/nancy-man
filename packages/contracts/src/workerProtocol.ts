export type WorkerCommand = {
  protocolVersion: 1;
  commandId: string;
  issuedAt: string;
  nonce: string;
  actor: { userId: string; sessionId: string; role: 'ops_maintainer' | 'ops_owner' };
  kind: 'schema.read' | 'sql.classify' | 'sql.previewRead' | 'sql.cancel';
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
