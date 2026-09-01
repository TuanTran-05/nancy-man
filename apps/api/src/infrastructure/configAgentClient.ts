import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

import {
  AGENT_PROTOCOL_VERSION,
  AgentActorSchema,
  AgentCapabilitiesResponseSchema,
  AgentRequestSchema,
  AgentResponseSchema,
  type AgentActor,
  type AgentOperation,
  type AgentCapabilitiesResponse,
  type AgentRequestEnvelope,
  type AgentResponseEnvelope,
  type InventoryReadRequest,
  type InventoryReadResponse
} from '../../../../packages/config-contracts/src/agentProtocol.js';
import type { ApplyStrategy } from '../../../../packages/config-contracts/src/catalog.js';
import {
  ChangeApplyStartedResponseSchema,
  ChangeCancelledResponseSchema,
  ChangeSavedResponseSchema,
  ChangeStatusResponseSchema,
  ChangeValidationResponseSchema,
  ApplyBlockClearedResponseSchema
} from '../../../../packages/config-contracts/src/changeProtocol.js';
import type {
  ChangeApplyRequest,
  ChangeCancelRequest,
  ChangeSaveRequest,
  ChangeStatusRequest,
  ChangeValidateRequest,
  ClearApplyBlockRequest,
  ChangeValidationResponse,
  ChangeStatusResponse
} from '../../../../packages/config-contracts/src/changeProtocol.js';
import {
  encodeFrame,
  FrameDecoder,
  MAX_FRAME_BYTES
} from '../../../../packages/config-contracts/src/framing.js';

const defaultStartupActor: AgentActor = {
  userId: '00000000-0000-0000-0000-000000000000',
  sessionId: '00000000-0000-0000-0000-000000000000',
  role: 'ops_owner',
  ipHash: `sha256:${'0'.repeat(64)}`,
  userAgentHash: `sha256:${'0'.repeat(64)}`
};

export type ConfigAgentClientOptions = {
  socketPath: string;
  hmacKey: string | Buffer;
  hmacKeyId: string;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  totalTimeoutMs?: number;
  maximumResponseBytes?: number;
  now?: () => Date;
  requestId?: () => string;
  startupActor?: AgentActor;
};

export type ConfigAgentExpectations = {
  protocolVersion?: typeof AGENT_PROTOCOL_VERSION;
  manifestVersion: string;
  catalogVersion: string;
  catalogDigest: string;
  requiredOperations?: readonly AgentOperation[];
  requiredStrategies?: readonly ApplyStrategy[];
};

export class ConfigAgentError extends Error {
  constructor(
    readonly code:
      | 'AGENT_CONNECT_TIMEOUT'
      | 'AGENT_CONNECT_FAILED'
      | 'AGENT_READ_TIMEOUT'
      | 'AGENT_TOTAL_TIMEOUT'
      | 'AGENT_RESPONSE_TOO_LARGE'
      | 'AGENT_EMPTY_RESPONSE'
      | 'AGENT_TRAILING_FRAME'
      | 'AGENT_PROTOCOL_INVALID'
      | 'AGENT_RESPONSE_MISMATCH'
      | 'AGENT_RESPONSE_SIGNATURE_INVALID'
      | 'AGENT_RESPONSE_EXPIRED'
      | 'AGENT_REQUEST_INVALID'
      | 'CONFIG_AGENT_INCOMPATIBLE'
      | 'CONFIG_AGENT_REJECTED'
      | 'CONFIG_SOURCE_CHANGED'
      | 'CONFIG_APPLICATION_BLOCKED'
      | 'CONFIG_CHANGE_INVALID_STATE'
      | 'CONFIG_CHANGE_NOT_FOUND'
      | 'CONFIG_ROLLBACK_FAILED'
  ) {
    super(code);
    this.name = 'ConfigAgentError';
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)])
    );
  }
  return value;
}

function canonicalEnvelope(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
  }
  const unsigned = { ...(value as Record<string, unknown>) };
  delete unsigned.signature;
  return `${JSON.stringify(canonicalValue(unsigned))}\n`;
}

export function signAgentEnvelope(value: unknown, key: string | Buffer): string {
  const digest = createHmac('sha256', key).update(canonicalEnvelope(value), 'utf8').digest('hex');
  return `hmac-sha256:v1:${digest}`;
}

function verifySignature(value: AgentResponseEnvelope, key: string | Buffer): boolean {
  const expected = Buffer.from(signAgentEnvelope(value, key), 'utf8');
  const actual = Buffer.from(value.signature, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function validRequestId(value: string): boolean {
  return /^REQ_[A-Za-z0-9_]+$/u.test(value);
}

function validSocketPath(value: string): boolean {
  return value.startsWith('/') && value.length > 1 && value.endsWith('.sock');
}

function duration(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0 || selected > 60_000) {
    throw new ConfigAgentError('AGENT_REQUEST_INVALID');
  }
  return selected;
}

function maxBytes(value: number | undefined): number {
  const selected = value ?? MAX_FRAME_BYTES;
  if (!Number.isSafeInteger(selected) || selected <= 0 || selected > MAX_FRAME_BYTES) {
    throw new ConfigAgentError('AGENT_RESPONSE_TOO_LARGE');
  }
  return selected;
}

export class ConfigAgentClient {
  private readonly socketPath: string;
  private readonly hmacKey: string | Buffer;
  private readonly hmacKeyId: string;
  private readonly connectTimeoutMs: number;
  private readonly readTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maximumResponseBytes: number;
  private readonly now: () => Date;
  private readonly requestId: () => string;
  private readonly startupActor: AgentActor;
  private negotiatedExpectations: ConfigAgentExpectations | undefined;

  constructor(input: ConfigAgentClientOptions) {
    if (!validSocketPath(input.socketPath)) throw new ConfigAgentError('AGENT_REQUEST_INVALID');
    if (!input.hmacKey || !input.hmacKeyId) throw new ConfigAgentError('AGENT_REQUEST_INVALID');
    if (!validRequestId(input.requestId?.() ?? 'REQ_probe')) {
      throw new ConfigAgentError('AGENT_REQUEST_INVALID');
    }
    this.socketPath = input.socketPath;
    this.hmacKey = input.hmacKey;
    this.hmacKeyId = input.hmacKeyId;
    this.connectTimeoutMs = duration(input.connectTimeoutMs, 5_000);
    this.readTimeoutMs = duration(input.readTimeoutMs, 5_000);
    this.totalTimeoutMs = duration(input.totalTimeoutMs, 15_000);
    this.maximumResponseBytes = maxBytes(input.maximumResponseBytes);
    this.now = input.now ?? (() => new Date());
    this.requestId = input.requestId ?? (() => `REQ_${randomUUID().replaceAll('-', '')}`);
    this.startupActor = input.startupActor ?? defaultStartupActor;
    if (!AgentActorSchema.safeParse(this.startupActor).success) {
      throw new ConfigAgentError('AGENT_REQUEST_INVALID');
    }
  }

  async negotiate(expected: ConfigAgentExpectations): Promise<AgentCapabilitiesResponse> {
    const response = await this.request({
      operation: 'agent.capabilities',
      body: {},
      actor: this.startupActor
    });
    if (!response.ok || response.operation !== 'agent.capabilities') {
      throw new ConfigAgentError('CONFIG_AGENT_REJECTED');
    }
    const capabilities = AgentCapabilitiesResponseSchema.safeParse(response.body);
    if (!capabilities.success) throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
    if (
      capabilities.data.protocolVersion !== (expected.protocolVersion ?? AGENT_PROTOCOL_VERSION) ||
      capabilities.data.readOnly !== true ||
      !capabilities.data.supportedOperations.includes('inventory.read') ||
      (expected.requiredOperations ?? []).some(
        (operation) => !capabilities.data.supportedOperations.includes(operation)
      ) ||
      (expected.requiredStrategies ?? []).some(
        (strategy) => !capabilities.data.supportedStrategies?.includes(strategy)
      ) ||
      capabilities.data.manifestVersion !== expected.manifestVersion ||
      capabilities.data.catalogVersion !== expected.catalogVersion ||
      capabilities.data.catalogDigest !== expected.catalogDigest ||
      capabilities.data.maximumFrameBytes !== MAX_FRAME_BYTES
    ) {
      throw new ConfigAgentError('CONFIG_AGENT_INCOMPATIBLE');
    }
    this.negotiatedExpectations = expected;
    return capabilities.data;
  }

  async readInventory(
    actor: AgentActor,
    filters: Omit<InventoryReadRequest, 'includeValues'> = {}
  ): Promise<InventoryReadResponse> {
    const response = await this.request({
      operation: 'inventory.read',
      body: { includeValues: true, ...filters },
      actor
    });
    if (!response.ok || response.operation !== 'inventory.read') {
      throw new ConfigAgentError('CONFIG_AGENT_REJECTED');
    }
    if (
      this.negotiatedExpectations &&
      (response.body.catalogVersion !== this.negotiatedExpectations.catalogVersion ||
        response.body.manifestVersion !== this.negotiatedExpectations.manifestVersion)
    ) {
      throw new ConfigAgentError('AGENT_RESPONSE_MISMATCH');
    }
    return response.body;
  }

  async validateChange(
    actor: AgentActor,
    input: ChangeValidateRequest
  ): Promise<ChangeValidationResponse> {
    const response = await this.request({ operation: 'change.validate', body: input, actor });
    if (!response.ok || response.operation !== 'change.validate') this.rejectResponse(response);
    const parsed = ChangeValidationResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
    return parsed.data;
  }

  async saveChange(actor: AgentActor, input: ChangeSaveRequest) {
    const response = await this.request({ operation: 'change.save', body: input, actor });
    if (!response.ok || response.operation !== 'change.save') this.rejectResponse(response);
    const parsed = ChangeSavedResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
    return parsed.data;
  }

  async applyChange(actor: AgentActor, input: ChangeApplyRequest) {
    const response = await this.request({ operation: 'change.apply', body: input, actor });
    if (!response.ok || response.operation !== 'change.apply') this.rejectResponse(response);
    const parsed = ChangeApplyStartedResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
    return parsed.data;
  }

  async cancelChange(actor: AgentActor, input: ChangeCancelRequest) {
    const response = await this.request({ operation: 'change.cancel', body: input, actor });
    if (!response.ok || response.operation !== 'change.cancel') this.rejectResponse(response);
    const parsed = ChangeCancelledResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
    return parsed.data;
  }

  async getChangeStatus(
    actor: AgentActor,
    input: ChangeStatusRequest
  ): Promise<ChangeStatusResponse> {
    const response = await this.request({ operation: 'change.status', body: input, actor });
    if (!response.ok || response.operation !== 'change.status') this.rejectResponse(response);
    const parsed = ChangeStatusResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
    return parsed.data;
  }

  async clearApplyBlock(actor: AgentActor, input: ClearApplyBlockRequest) {
    const response = await this.request({
      operation: 'application.clearApplyBlock',
      body: input,
      actor
    });
    if (!response.ok || response.operation !== 'application.clearApplyBlock')
      this.rejectResponse(response);
    const parsed = ApplyBlockClearedResponseSchema.safeParse(response.body);
    if (!parsed.success) throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
    return parsed.data;
  }

  private async request(input: {
    operation: AgentRequestEnvelope['operation'];
    body: Record<string, unknown>;
    actor: AgentActor;
  }): Promise<AgentResponseEnvelope> {
    const issuedAt = this.now();
    const requestId = this.requestId();
    const unsigned = {
      version: AGENT_PROTOCOL_VERSION,
      requestId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + Math.min(this.totalTimeoutMs, 30_000)).toISOString(),
      actor: input.actor,
      operation: input.operation,
      body: input.body,
      hmacKeyId: this.hmacKeyId
    } as const;
    const request = { ...unsigned, signature: signAgentEnvelope(unsigned, this.hmacKey) };
    if (!AgentRequestSchema.safeParse(request).success) {
      throw new ConfigAgentError('AGENT_REQUEST_INVALID');
    }
    const response = await this.exchange(encodeFrame(request), requestId);
    const parsed = AgentResponseSchema.safeParse(response);
    if (!parsed.success) throw new ConfigAgentError('AGENT_PROTOCOL_INVALID');
    if (parsed.data.requestId !== requestId || parsed.data.operation !== input.operation) {
      throw new ConfigAgentError('AGENT_RESPONSE_MISMATCH');
    }
    if (parsed.data.hmacKeyId !== this.hmacKeyId) {
      throw new ConfigAgentError('AGENT_RESPONSE_SIGNATURE_INVALID');
    }
    if (!verifySignature(parsed.data, this.hmacKey)) {
      throw new ConfigAgentError('AGENT_RESPONSE_SIGNATURE_INVALID');
    }
    const issued = Date.parse(parsed.data.issuedAt);
    const expires = Date.parse(parsed.data.expiresAt);
    const currentTime = this.now().getTime();
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > currentTime + 30_000 ||
      expires <= issued ||
      expires > issued + 60_000 ||
      expires <= currentTime
    ) {
      throw new ConfigAgentError('AGENT_RESPONSE_EXPIRED');
    }
    return parsed.data;
  }

  private rejectResponse(response: AgentResponseEnvelope): never {
    if (!response.ok) {
      const code = response.error.code.toUpperCase();
      const known = new Set<ConfigAgentError['code']>([
        'CONFIG_SOURCE_CHANGED',
        'CONFIG_APPLICATION_BLOCKED',
        'CONFIG_CHANGE_INVALID_STATE',
        'CONFIG_CHANGE_NOT_FOUND',
        'CONFIG_ROLLBACK_FAILED'
      ]);
      if (known.has(code as ConfigAgentError['code'])) {
        throw new ConfigAgentError(code as ConfigAgentError['code']);
      }
    }
    throw new ConfigAgentError('CONFIG_AGENT_REJECTED');
  }

  private exchange(frame: Buffer, requestId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let socket: Socket | undefined;
      let settled = false;
      let connected = false;
      let receivedBytes = 0;
      let decodedResponse: unknown;
      const decoder = new FrameDecoder();
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      let readTimer: ReturnType<typeof setTimeout> | undefined;
      const totalTimer = setTimeout(() => fail('AGENT_TOTAL_TIMEOUT'), this.totalTimeoutMs);

      const clearTimers = () => {
        clearTimeout(connectTimer);
        clearTimeout(readTimer);
        clearTimeout(totalTimer);
      };
      const fail = (code: ConfigAgentError['code']) => {
        if (settled) return;
        settled = true;
        clearTimers();
        socket?.destroy();
        reject(new ConfigAgentError(code));
      };
      const armReadTimer = () => {
        clearTimeout(readTimer);
        readTimer = setTimeout(() => fail('AGENT_READ_TIMEOUT'), this.readTimeoutMs);
      };

      try {
        connectTimer = setTimeout(() => fail('AGENT_CONNECT_TIMEOUT'), this.connectTimeoutMs);
        socket = createConnection(this.socketPath);
        socket.once('connect', () => {
          if (settled) return;
          connected = true;
          clearTimeout(connectTimer);
          armReadTimer();
          socket?.write(frame);
        });
        socket.on('data', (chunk: Buffer) => {
          if (settled) return;
          receivedBytes += chunk.length;
          if (receivedBytes > this.maximumResponseBytes) {
            fail('AGENT_RESPONSE_TOO_LARGE');
            return;
          }
          armReadTimer();
          let values: unknown[];
          try {
            values = decoder.push(chunk);
          } catch {
            fail('AGENT_PROTOCOL_INVALID');
            return;
          }
          if (values.length > 1 || (values.length === 1 && decodedResponse !== undefined)) {
            fail('AGENT_TRAILING_FRAME');
            return;
          }
          if (values.length === 1) decodedResponse = values[0];
        });
        socket.once('end', () => {
          if (settled) return;
          clearTimeout(readTimer);
          try {
            decoder.finish();
          } catch {
            fail('AGENT_TRAILING_FRAME');
            return;
          }
          if (decodedResponse === undefined) {
            fail('AGENT_EMPTY_RESPONSE');
            return;
          }
          settled = true;
          clearTimers();
          resolve(decodedResponse);
        });
        socket.once('error', () => {
          if (!connected) fail('AGENT_CONNECT_FAILED');
          else fail('AGENT_PROTOCOL_INVALID');
        });
        socket.once('close', () => {
          if (!settled && decodedResponse === undefined) {
            fail(connected ? 'AGENT_EMPTY_RESPONSE' : 'AGENT_CONNECT_FAILED');
          }
        });
      } catch {
        fail('AGENT_CONNECT_FAILED');
      }

      void requestId;
    });
  }
}
