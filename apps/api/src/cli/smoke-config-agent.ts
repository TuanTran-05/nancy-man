#!/usr/bin/env node
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

const protocolCredentialPath =
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
  } catch {
    throw new Error('CONFIG_AGENT_SMOKE_MANIFEST_INVALID');
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
    hmacKey = (await readFile(protocolCredentialPath, 'utf8')).trim();
  } catch {
    throw new Error('CONFIG_AGENT_SMOKE_CREDENTIAL_UNAVAILABLE');
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

if (process.argv[1]?.endsWith('/smoke-config-agent.js')) {
  smokeConfigAgent(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error: unknown) => {
      const code =
        error instanceof ConfigAgentError ||
        (error instanceof Error && /^CONFIG_AGENT_[A-Z0-9_]+$/u.test(error.message))
          ? error.message
          : 'CONFIG_AGENT_SMOKE_FAILED';
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    });
}
