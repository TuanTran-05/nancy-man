import { createHmac, timingSafeEqual } from 'node:crypto';
import { chmodSync, chownSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { dirname } from 'node:path';

import {
  AgentCapabilitiesResponseSchema,
  AgentRequestSchema,
  AgentResponseSchema,
  ChangeApplyRequestSchema,
  ChangeApplyStartedResponseSchema,
  ChangeCancelRequestSchema,
  ChangeCancelledResponseSchema,
  ChangeSavedResponseSchema,
  ChangeSaveRequestSchema,
  ChangeStatusResponseSchema,
  ChangeStatusRequestSchema,
  ChangeValidationResponseSchema,
  ChangeValidateRequestSchema,
  ApplyBlockClearedResponseSchema,
  ClearApplyBlockRequestSchema,
  type AgentActor,
  type ChangeApplyRequest,
  type ChangeCancelRequest,
  type ChangeSaveRequest,
  type ChangeStatusRequest,
  type ChangeValidateRequest,
  type ClearApplyBlockRequest,
  encodeFrame,
  FrameDecoder,
  MAX_FRAME_BYTES,
  type AgentRequestEnvelope,
  type AgentResponseEnvelope
} from '../../../../packages/config-contracts/src/index.js';
import type { FingerprintKey } from '../inventory/fingerprint.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import type { LoadedCatalogAndManifest } from '../manifestLoader.js';

export type AuthenticatedServerOptions = Readonly<{
  socketPath: string;
  socketGroup?: string;
  socketGroupId?: number;
  protocolKey: string | Uint8Array;
  protocolKeyId: string;
  fingerprintKey: FingerprintKey;
  loaded: LoadedCatalogAndManifest;
  inventoryService: InventoryService;
  now?: () => Date;
  clockSkewMs?: number;
  requestTtlMs?: number;
  allowedPeerUid?: number;
  allowedPeerGid?: number;
  changeHandlers?: AgentMutationHandlers;
}>;

export type AgentMutationHandlers = Readonly<{
  validate?: (request: ChangeValidateRequest, actor: AgentActor) => Promise<unknown>;
  save?: (request: ChangeSaveRequest, actor: AgentActor) => Promise<unknown>;
  apply?: (request: ChangeApplyRequest, actor: AgentActor) => Promise<unknown>;
  cancel?: (request: ChangeCancelRequest, actor: AgentActor) => Promise<unknown>;
  status?: (request: ChangeStatusRequest, actor: AgentActor) => Promise<unknown>;
  clearApplyBlock?: (request: ClearApplyBlockRequest, actor: AgentActor) => Promise<unknown>;
  supportedStrategies?: readonly string[];
}>;

export type AuthenticatedServer = Readonly<{
  server: net.Server;
  start: () => Promise<void>;
  close: () => Promise<void>;
}>;

type PeerCredentials = Readonly<{ uid: number; gid: number }>;
type PeerAwareSocket = net.Socket & {
  getPeerCredentials?: () => PeerCredentials;
};

export type ProtocolServerErrorCode =
  | 'AGENT_PROTOCOL_KEY_INVALID'
  | 'AGENT_KEYS_MUST_DIFFER'
  | 'AGENT_SOCKET_INVALID'
  | 'AGENT_SOCKET_GROUP_INVALID'
  | 'AGENT_PEER_NOT_ALLOWED'
  | 'AGENT_PROTOCOL_REJECTED';

export class ProtocolServerError extends Error {
  readonly code: ProtocolServerErrorCode;

  constructor(code: ProtocolServerErrorCode) {
    super(code);
    this.name = 'ProtocolServerError';
    this.code = code;
  }
}

function bytes(value: string | Uint8Array): Buffer {
  const result = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  if (result.length === 0) throw new ProtocolServerError('AGENT_PROTOCOL_KEY_INVALID');
  return result;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function unsignedEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  const unsigned = { ...value };
  delete unsigned.signature;
  return unsigned;
}

function signatureFor(key: Buffer, value: Record<string, unknown>): string {
  const digest = createHmac('sha256', key)
    .update(canonicalJson(unsignedEnvelope(value)), 'utf8')
    .digest('hex');
  return `hmac-sha256:v1:${digest}`;
}

export function signAgentRequest(
  request: Omit<AgentRequestEnvelope, 'signature'>,
  protocolKey: string | Uint8Array
): AgentRequestEnvelope {
  const value = { ...request } as Record<string, unknown>;
  return AgentRequestSchema.parse({ ...value, signature: signatureFor(bytes(protocolKey), value) });
}

function groupId(name: string): number | undefined {
  try {
    for (const line of readFileSync('/etc/group', 'utf8').split(/\r?\n/u)) {
      const fields = line.split(':');
      if (fields[0] === name && fields[2] && /^[0-9]+$/u.test(fields[2])) return Number(fields[2]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function removeSocketIfSafe(socketPath: string): void {
  try {
    const stat = lstatSync(socketPath);
    if (!stat.isSocket()) throw new ProtocolServerError('AGENT_SOCKET_INVALID');
    unlinkSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (error instanceof ProtocolServerError) throw error;
    throw new ProtocolServerError('AGENT_SOCKET_INVALID');
  }
}

function peerAllowed(socket: PeerAwareSocket, options: AuthenticatedServerOptions): boolean {
  if (options.allowedPeerUid === undefined && options.allowedPeerGid === undefined) return true;
  const readPeerCredentials = socket.getPeerCredentials;
  if (typeof readPeerCredentials !== 'function') return true;
  let credentials: PeerCredentials;
  try {
    credentials = readPeerCredentials.call(socket);
  } catch {
    return false;
  }
  return (
    (options.allowedPeerUid === undefined || credentials.uid === options.allowedPeerUid) &&
    (options.allowedPeerGid === undefined || credentials.gid === options.allowedPeerGid)
  );
}

function protocolFailure(socket: net.Socket): void {
  socket.destroy();
}

function valueFreeRecord(operation: string, body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
  }
  const forbidden = /^(?:value|oldValue|newValue|bytes|plaintext|command|args|argv|environment|stdout|stderr)$/iu;
  const inspect = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) inspect(item);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (forbidden.test(key)) throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
      inspect(nested);
    }
  };
  inspect(body);
  void operation;
  return body as Record<string, unknown>;
}

function validateMutationResponse(operation: AgentRequestEnvelope['operation'], body: unknown): Record<string, unknown> {
  const safeBody = valueFreeRecord(operation, body);
  switch (operation) {
    case 'change.validate':
      return ChangeValidationResponseSchema.parse(safeBody) as Record<string, unknown>;
    case 'change.save':
      return ChangeSavedResponseSchema.parse(safeBody) as Record<string, unknown>;
    case 'change.apply':
      return ChangeApplyStartedResponseSchema.parse(safeBody) as Record<string, unknown>;
    case 'change.cancel':
      return ChangeCancelledResponseSchema.parse(safeBody) as Record<string, unknown>;
    case 'change.status':
      return ChangeStatusResponseSchema.parse(safeBody) as Record<string, unknown>;
    case 'application.clearApplyBlock':
      return ApplyBlockClearedResponseSchema.parse(safeBody) as Record<string, unknown>;
    default:
      throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
  }
}

function mutationHandler(
  options: AuthenticatedServerOptions,
  operation: Exclude<AgentRequestEnvelope['operation'], 'agent.capabilities' | 'inventory.read'>
): ((request: never, actor: AgentActor) => Promise<unknown>) | undefined {
  const handlers = options.changeHandlers;
  if (!handlers) return undefined;
  switch (operation) {
    case 'change.validate':
      return handlers.validate as ((request: never, actor: AgentActor) => Promise<unknown>) | undefined;
    case 'change.save':
      return handlers.save as ((request: never, actor: AgentActor) => Promise<unknown>) | undefined;
    case 'change.apply':
      return handlers.apply as ((request: never, actor: AgentActor) => Promise<unknown>) | undefined;
    case 'change.cancel':
      return handlers.cancel as ((request: never, actor: AgentActor) => Promise<unknown>) | undefined;
    case 'change.status':
      return handlers.status as ((request: never, actor: AgentActor) => Promise<unknown>) | undefined;
    case 'application.clearApplyBlock':
      return handlers.clearApplyBlock as ((request: never, actor: AgentActor) => Promise<unknown>) | undefined;
  }
}

function protocolErrorCode(operation: string, error: unknown): string {
  const candidate = error instanceof Error && 'code' in error ? String(error.code) : '';
  if (/^[a-z][a-z0-9_]*$/u.test(candidate)) return candidate;
  return `${operation.replace(/[^a-z0-9]+/giu, '_').replace(/^_|_$/gu, '').toLowerCase()}_failed`;
}

export function createAuthenticatedServer(
  options: AuthenticatedServerOptions
): AuthenticatedServer {
  const protocolKey = bytes(options.protocolKey);
  const fingerprintSecret = Buffer.from(options.fingerprintKey.secret);
  if (
    fingerprintSecret.length === 0 ||
    (protocolKey.length === fingerprintSecret.length &&
      timingSafeEqual(protocolKey, fingerprintSecret))
  ) {
    throw new ProtocolServerError('AGENT_KEYS_MUST_DIFFER');
  }
  const now = options.now ?? (() => new Date());
  const clockSkewMs = options.clockSkewMs ?? 60_000;
  const requestTtlMs = options.requestTtlMs ?? 60_000;
  const replayedRequests = new Map<string, number>();
  const server = net.createServer((socket) => {
    if (!peerAllowed(socket as PeerAwareSocket, options)) {
      protocolFailure(socket);
      return;
    }

    const decoder = new FrameDecoder();
    let frameSeen = false;
    let responseSent = false;
    let closed = false;
    let chain = Promise.resolve();

    const reject = (): void => {
      if (closed) return;
      closed = true;
      protocolFailure(socket);
    };

    const dispatch = async (value: unknown): Promise<AgentResponseEnvelope> => {
      const parsed = AgentRequestSchema.safeParse(value);
      if (!parsed.success) throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
      const request = parsed.data;
      const current = now();
      const issuedAt = Date.parse(request.issuedAt);
      const expiresAt = Date.parse(request.expiresAt);
      if (
        !Number.isFinite(issuedAt) ||
        !Number.isFinite(expiresAt) ||
        issuedAt > current.getTime() + clockSkewMs ||
        issuedAt < current.getTime() - requestTtlMs - clockSkewMs ||
        expiresAt <= issuedAt ||
        expiresAt < current.getTime() ||
        expiresAt > current.getTime() + requestTtlMs + clockSkewMs
      ) {
        throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
      }
      if (request.hmacKeyId !== options.protocolKeyId) {
        throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
      }
      const supplied = /^hmac-sha256:v1:([a-f0-9]{64})$/u.exec(request.signature)?.[1];
      if (!supplied) throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
      const expected = Buffer.from(signatureFor(protocolKey, request), 'utf8');
      const actual = Buffer.from(request.signature, 'utf8');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
      }
      for (const [requestId, expiry] of replayedRequests) {
        if (expiry <= current.getTime()) replayedRequests.delete(requestId);
      }
      // Request IDs are the protocol nonce in v1; retaining both checks here prevents reuse.
      if (replayedRequests.has(request.requestId)) {
        throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
      }
      if (replayedRequests.size >= 2_048) {
        const oldest = replayedRequests.keys().next().value;
        if (oldest) replayedRequests.delete(oldest);
      }
      replayedRequests.set(request.requestId, expiresAt);

      const responseIssuedAt = current.toISOString();
      const responseExpiresAt = new Date(current.getTime() + requestTtlMs).toISOString();
      if (request.operation === 'agent.capabilities') {
        const mutationOperations = [
          ['change.validate', options.changeHandlers?.validate],
          ['change.save', options.changeHandlers?.save],
          ['change.apply', options.changeHandlers?.apply],
          ['change.cancel', options.changeHandlers?.cancel],
          ['change.status', options.changeHandlers?.status],
          ['application.clearApplyBlock', options.changeHandlers?.clearApplyBlock]
        ] as const;
        const supportedOperations = [
          'inventory.read',
          ...mutationOperations.filter(([, handler]) => handler).map(([operation]) => operation)
        ];
        const body = AgentCapabilitiesResponseSchema.parse({
          protocolVersion: 1,
          readOnly: mutationOperations.every(([, handler]) => !handler),
          supportedOperations,
          ...(options.changeHandlers?.supportedStrategies
            ? { supportedStrategies: [...options.changeHandlers.supportedStrategies] }
            : {}),
          manifestVersion: options.loaded.manifest.manifestVersion,
          catalogVersion: options.loaded.catalog.catalogVersion,
          catalogDigest: options.loaded.catalogDigest,
          maximumFrameBytes: MAX_FRAME_BYTES
        });
        const unsigned = {
          version: 1,
          requestId: request.requestId,
          issuedAt: responseIssuedAt,
          expiresAt: responseExpiresAt,
          operation: request.operation,
          ok: true,
          body,
          hmacKeyId: options.protocolKeyId
        };
        return AgentResponseSchema.parse({
          ...unsigned,
          signature: signatureFor(protocolKey, unsigned)
        });
      }

      try {
        let body: unknown;
        if (request.operation === 'inventory.read') {
          body = await options.inventoryService.read(request.body);
        } else {
          const handler = mutationHandler(options, request.operation);
          if (!handler) throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
          body = await handler(request.body as never, request.actor);
          body = validateMutationResponse(request.operation, body);
        }
        const unsigned = {
          version: 1,
          requestId: request.requestId,
          issuedAt: responseIssuedAt,
          expiresAt: responseExpiresAt,
          operation: request.operation,
          ok: true,
          body,
          hmacKeyId: options.protocolKeyId
        };
        return AgentResponseSchema.parse({
          ...unsigned,
          signature: signatureFor(protocolKey, unsigned)
        });
      } catch (error) {
        const unsigned = {
          version: 1,
          requestId: request.requestId,
          issuedAt: responseIssuedAt,
          expiresAt: responseExpiresAt,
          operation: request.operation,
          ok: false,
          error: {
            code: protocolErrorCode(request.operation, error),
            safeMessage: 'Config Agent operation failed'
          },
          hmacKeyId: options.protocolKeyId
        };
        return AgentResponseSchema.parse({
          ...unsigned,
          signature: signatureFor(protocolKey, unsigned)
        });
      }
    };

    const handleChunk = async (chunk: Buffer): Promise<void> => {
      if (closed) return;
      const frames = decoder.push(chunk);
      if (frames.length === 0) return;
      if (frameSeen || frames.length !== 1)
        throw new ProtocolServerError('AGENT_PROTOCOL_REJECTED');
      frameSeen = true;
      const response = await dispatch(frames[0]);
      if (closed) return;
      const framed = encodeFrame(response);
      responseSent = true;
      socket.end(framed);
    };

    socket.on('data', (chunk: Buffer) => {
      chain = chain.then(() => handleChunk(chunk)).catch(() => reject());
    });
    socket.on('end', () => {
      chain = chain
        .then(() => {
          try {
            decoder.finish();
            if (!frameSeen || !responseSent) reject();
          } catch {
            reject();
          }
        })
        .catch(() => reject());
    });
    socket.on('error', () => {
      closed = true;
    });
  });

  let started = false;
  async function start(): Promise<void> {
    if (started) return;
    removeSocketIfSafe(options.socketPath);
    mkdirSync(dirname(options.socketPath), { recursive: true, mode: 0o755 });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(new ProtocolServerError('AGENT_SOCKET_INVALID'));
        void error;
      };
      const onListening = () => {
        server.off('error', onError);
        try {
          chmodSync(options.socketPath, 0o660);
          const gid =
            options.socketGroupId ??
            (options.socketGroup ? groupId(options.socketGroup) : undefined);
          if (options.socketGroup && gid === undefined) {
            throw new ProtocolServerError('AGENT_SOCKET_GROUP_INVALID');
          }
          if (gid !== undefined) {
            const stat = lstatSync(options.socketPath);
            chownSync(options.socketPath, stat.uid, gid);
          }
          resolve();
        } catch (error) {
          server.close();
          reject(
            error instanceof ProtocolServerError
              ? error
              : new ProtocolServerError('AGENT_SOCKET_INVALID')
          );
        }
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(options.socketPath);
    });
    started = true;
  }

  async function close(): Promise<void> {
    if (started) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      started = false;
    }
    try {
      const stat = lstatSync(options.socketPath);
      if (stat.isSocket()) unlinkSync(options.socketPath);
    } catch {
      // The socket may already have been removed by the host supervisor.
    }
  }

  return { server, start, close };
}

export async function startAuthenticatedServer(
  options: AuthenticatedServerOptions
): Promise<AuthenticatedServer> {
  const server = createAuthenticatedServer(options);
  await server.start();
  return server;
}
