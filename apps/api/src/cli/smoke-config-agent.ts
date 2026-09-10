#!/usr/bin/env node
import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import { readFile } from 'node:fs/promises';

import { parse as parseYaml } from 'yaml';

import type {
  AgentActor,
  AgentCapabilitiesResponse,
  InventoryReadResponse
} from '../../../../packages/config-contracts/src/agentProtocol.js';
import {
  ConfigAgentClient,
  ConfigAgentError,
  type ConfigAgentExpectations
} from '../infrastructure/configAgentClient.js';
import { FileSecretResolver } from '../runtime/fileSecretResolver.js';
import {
  createOpsProcessRuntimeTelemetryFromEnvironment,
  runConfiguredOpsTelemetryOneShot
} from '../../../../packages/telemetry-sdk/src/oneShot.js';
import type { RuntimeTelemetry } from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';

const defaultProtocolCredentialPath =
  '/run/credentials/edutrack-ops-api.service/config-agent-protocol-hmac';
const manifestPath = '/srv/edutrack-ops/config-agent/current/deploy/ops/config-agent/manifest.yaml';
const defaultProtocolKeyId = 'config-agent-2026-08-31';
const smokeActor: AgentActor = {
  userId: '00000000-0000-0000-0000-000000000000',
  sessionId: '00000000-0000-0000-0000-000000000000',
  role: 'ops_owner',
  ipHash: `sha256:${'0'.repeat(64)}`,
  userAgentHash: `sha256:${'0'.repeat(64)}`
};

type SmokeClient = {
  negotiate: (expected: ConfigAgentExpectations) => Promise<AgentCapabilitiesResponse>;
  readInventory: (actor: AgentActor) => Promise<InventoryReadResponse>;
};

export type ConfigAgentSmokeDependencies = {
  loadExpectations: () => Promise<ConfigAgentExpectations>;
  createClient: (socketPath: string) => Promise<SmokeClient>;
};

type SmokeArguments =
  | { operation: 'agent.capabilities'; socketPath: string }
  | { operation: 'inventory.read'; socketPath: string };

export type ConfigAgentSmokeResult =
  | ({ operation: 'agent.capabilities' } & AgentCapabilitiesResponse & {
        supportedStrategies: NonNullable<AgentCapabilitiesResponse['supportedStrategies']>;
      })
  | {
      operation: 'inventory.read';
      catalogVersion: string;
      manifestVersion: string;
      itemCount: number;
      sourceIds: string[];
    };

export function resolveConfigAgentSmokeProtocolCredentialPath(
  environment: Readonly<Record<string, string | undefined>> = process.env
): string {
  const explicit = environment.OPS_CONFIG_AGENT_SMOKE_PROTOCOL_HMAC_FILE?.trim();
  if (explicit) return explicit;
  const credentialsDirectory = environment.CREDENTIALS_DIRECTORY?.trim().replace(/\/+$/u, '');
  return credentialsDirectory
    ? `${credentialsDirectory}/config-agent-protocol-hmac`
    : defaultProtocolCredentialPath;
}

export function resolveConfigAgentSmokeTelemetryCredentialPath(
  environment: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  const explicit = environment.OPS_TELEMETRY_HMAC_FILE?.trim();
  if (explicit) return explicit;
  const credentialsDirectory = environment.CREDENTIALS_DIRECTORY?.trim().replace(/\/+$/u, '');
  return credentialsDirectory ? `${credentialsDirectory}/ops-telemetry-hmac` : undefined;
}

function usage(): never {
  throw new Error('CONFIG_AGENT_SMOKE_USAGE');
}

function parseArguments(arguments_: readonly string[]): SmokeArguments {
  const [operation, socketFlag, socketPath, outputFlag] = arguments_;
  if (
    socketFlag !== '--socket' ||
    !socketPath ||
    !socketPath.startsWith('/') ||
    !socketPath.endsWith('.sock')
  ) {
    return usage();
  }
  if (operation === 'agent.capabilities' && arguments_.length === 3) {
    return { operation, socketPath };
  }
  if (operation === 'inventory.read' && arguments_.length === 4 && outputFlag === '--ids-only') {
    return { operation, socketPath };
  }
  return usage();
}

function expectationValue(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error('CONFIG_AGENT_SMOKE_MANIFEST_INVALID');
  }
  return value;
}

async function loadExpectations(): Promise<ConfigAgentExpectations> {
  let manifest: unknown;
  try {
    manifest = parseYaml(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    captureOpsException(error, {
      code: 'UNHANDLED_OPS_EXCEPTION',
      source: 'process',
      status: 500,
    });
    throw new Error('CONFIG_AGENT_SMOKE_MANIFEST_INVALID', { cause: error });
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('CONFIG_AGENT_SMOKE_MANIFEST_INVALID');
  }
  const value = manifest as Record<string, unknown>;
  return {
    manifestVersion: expectationValue(
      value.manifestVersion,
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[A-Za-z0-9._-]+)?$/u
    ),
    catalogVersion: expectationValue(
      value.catalogVersion,
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[A-Za-z0-9._-]+)?$/u
    ),
    catalogDigest: expectationValue(value.catalogDigest, /^sha256:[a-f0-9]{64}$/u)
  };
}

async function createClient(socketPath: string): Promise<SmokeClient> {
  let hmacKey: string;
  try {
    hmacKey = (
      await readFile(resolveConfigAgentSmokeProtocolCredentialPath(process.env), 'utf8')
    ).trim();
  } catch (error) {
    captureOpsException(error, {
      code: 'UNHANDLED_OPS_EXCEPTION',
      source: 'process',
      status: 500,
    });
    throw new Error('CONFIG_AGENT_SMOKE_CREDENTIAL_UNAVAILABLE', { cause: error });
  }
  if (!hmacKey || hmacKey.length > 4_096) {
    throw new Error('CONFIG_AGENT_SMOKE_CREDENTIAL_UNAVAILABLE');
  }
  return new ConfigAgentClient({
    socketPath,
    hmacKey,
    hmacKeyId: process.env.OPS_CONFIG_AGENT_HMAC_KEY_ID ?? defaultProtocolKeyId,
    connectTimeoutMs: 500,
    readTimeoutMs: 1_000,
    totalTimeoutMs: 2_000,
    maximumResponseBytes: 1_048_576
  });
}

const productionDependencies: ConfigAgentSmokeDependencies = {
  loadExpectations,
  createClient
};

export async function smokeConfigAgent(
  arguments_: readonly string[],
  dependencies: ConfigAgentSmokeDependencies = productionDependencies
): Promise<ConfigAgentSmokeResult> {
  const input = parseArguments(arguments_);
  const client = await dependencies.createClient(input.socketPath);
  const capabilities = await client.negotiate(await dependencies.loadExpectations());
  if (input.operation === 'agent.capabilities') {
    return {
      operation: input.operation,
      protocolVersion: capabilities.protocolVersion,
      readOnly: capabilities.readOnly,
      manifestVersion: capabilities.manifestVersion,
      catalogVersion: capabilities.catalogVersion,
      catalogDigest: capabilities.catalogDigest,
      supportedOperations: [...capabilities.supportedOperations].sort(),
      supportedStrategies: [...(capabilities.supportedStrategies ?? [])].sort(),
      maximumFrameBytes: capabilities.maximumFrameBytes
    };
  }
  const inventory = await client.readInventory(smokeActor);
  return {
    operation: input.operation,
    catalogVersion: inventory.catalogVersion,
    manifestVersion: inventory.manifestVersion,
    itemCount: inventory.items.length,
    sourceIds: [...new Set(inventory.items.map((item) => item.sourceId))].sort()
  };
}

export function runConfigAgentSmokeEntrypoint(
  input: {
    arguments?: readonly string[];
    environment?: NodeJS.ProcessEnv;
    telemetry?: RuntimeTelemetry;
    run?: () => Promise<ConfigAgentSmokeResult>;
    onFailure?: (error: unknown) => void | Promise<void>;
    rethrow?: boolean;
  } = {}
): Promise<ConfigAgentSmokeResult | undefined> {
  const environment = input.environment ?? process.env;
  const common = {
    createTelemetry: () =>
      input.telemetry ??
      createOpsProcessRuntimeTelemetryFromEnvironment({
        environment,
        resolveHmacSecret: async (reference) => {
          const hmacFile = resolveConfigAgentSmokeTelemetryCredentialPath(environment);
          if (hmacFile) return readFile(hmacFile, 'utf8');
          const secretDirectory = environment.OPS_SECRET_DIRECTORY?.trim();
          if (!secretDirectory) throw new Error('OPS_TELEMETRY_HMAC_FILE is required');
          return new FileSecretResolver(secretDirectory).resolve(reference);
        },
        service: 'edutrack-ops-config-agent-smoke',
        spoolName: 'config-agent-smoke'
      }),
    failureContext: {
      code: 'CONFIG_AGENT_SMOKE_FAILED',
      source: 'process' as const,
      level: 'fatal' as const
    },
    run: input.run ?? (() => smokeConfigAgent(input.arguments ?? process.argv.slice(2))),
    ...(input.onFailure ? { onFailure: input.onFailure } : {})
  };
  return input.rethrow === false
    ? runConfiguredOpsTelemetryOneShot({ ...common, rethrow: false })
    : runConfiguredOpsTelemetryOneShot({ ...common, rethrow: true });
}

if (process.argv[1]?.endsWith('/smoke-config-agent.js')) {
  void runConfigAgentSmokeEntrypoint({
    rethrow: false,
    run: async () => {
      const result = await smokeConfigAgent(process.argv.slice(2));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result;
    },
    onFailure: (error: unknown) => {
      const code =
        error instanceof ConfigAgentError ||
        (error instanceof Error && /^CONFIG_AGENT_[A-Z0-9_]+$/u.test(error.message))
          ? error.message
          : 'CONFIG_AGENT_SMOKE_FAILED';
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    }
  });
}
