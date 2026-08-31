import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { createFingerprintKey } from './inventory/fingerprint.js';
import { createInventoryService } from './inventory/inventoryService.js';
import { loadCatalogAndManifest } from './manifestLoader.js';
import { loadEnvelopeKey, type EnvelopeKey } from './crypto/encryptedEnvelope.js';
import { createRuntimeMutationHandlers } from './changes/runtimeHandlers.js';
import {
  readConfigAgentRuntimeConfig,
  type ConfigAgentRuntimeConfig,
  type Environment
} from './runtimeConfig.js';
import {
  createAuthenticatedServer,
  type AgentMutationHandlers,
  type AuthenticatedServer
} from './protocol/authenticatedServer.js';

export type StartedConfigAgent = Readonly<{
  config: ConfigAgentRuntimeConfig;
  server: AuthenticatedServer;
}>;

export type ConfigAgentStartupErrorCode =
  | 'CONFIG_AGENT_KEY_READ_FAILED'
  | 'CONFIG_AGENT_KEY_EMPTY'
  | 'CONFIG_AGENT_KEY_TOO_LARGE'
  | 'CONFIG_AGENT_KEY_REUSED'
  | 'CONFIG_AGENT_START_FAILED';

export type ConfigAgentStartDependencies = Readonly<{
  changeHandlers?: AgentMutationHandlers;
}>;

function enabledChangeHandlers(
  config: ConfigAgentRuntimeConfig,
  handlers: AgentMutationHandlers | undefined
): AgentMutationHandlers | undefined {
  if (!handlers) return undefined;
  const draft = config.draftEnabled === true;
  const apply = config.runtimeApplyEnabled === true || config.buildApplyEnabled === true;
  const gated: AgentMutationHandlers = {
    ...(draft && handlers.validate ? { validate: handlers.validate } : {}),
    ...(draft && handlers.save ? { save: handlers.save } : {}),
    ...(apply && handlers.apply ? { apply: handlers.apply } : {}),
    ...(draft && handlers.cancel ? { cancel: handlers.cancel } : {}),
    ...((draft || apply) && handlers.status ? { status: handlers.status } : {}),
    ...(apply && handlers.clearApplyBlock ? { clearApplyBlock: handlers.clearApplyBlock } : {}),
    ...(handlers.supportedStrategies ? { supportedStrategies: handlers.supportedStrategies } : {})
  };
  return Object.keys(gated).length > 0 ? gated : undefined;
}

export class ConfigAgentStartupError extends Error {
  readonly code: ConfigAgentStartupErrorCode;

  constructor(code: ConfigAgentStartupErrorCode) {
    super(code);
    this.name = 'ConfigAgentStartupError';
    this.code = code;
  }
}

function loadCredential(path: string): Buffer {
  let key: Buffer;
  try {
    key = readFileSync(path);
  } catch {
    throw new ConfigAgentStartupError('CONFIG_AGENT_KEY_READ_FAILED');
  }
  if (key.length === 0) throw new ConfigAgentStartupError('CONFIG_AGENT_KEY_EMPTY');
  if (key.length > 4_096) throw new ConfigAgentStartupError('CONFIG_AGENT_KEY_TOO_LARGE');
  return key;
}

function keysMatch(left: Uint8Array, right: Uint8Array): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertKeySeparation(
  protocolKey: Uint8Array,
  fingerprintKey: Uint8Array,
  envelopeKeys: readonly EnvelopeKey[]
): void {
  const all = [
    Buffer.from(protocolKey),
    Buffer.from(fingerprintKey),
    ...envelopeKeys.map((key) => key.bytes)
  ];
  for (let first = 0; first < all.length; first += 1) {
    for (let second = first + 1; second < all.length; second += 1) {
      if (keysMatch(all[first]!, all[second]!)) {
        throw new ConfigAgentStartupError('CONFIG_AGENT_KEY_REUSED');
      }
    }
  }
}

export async function startConfigAgent(
  environment: Environment = process.env,
  dependencies: ConfigAgentStartDependencies = {}
): Promise<StartedConfigAgent> {
  const config = readConfigAgentRuntimeConfig(environment);
  const loaded = loadCatalogAndManifest({
    catalogPath: config.catalogPath,
    manifestPath: config.manifestPath
  });
  const protocolKey = loadCredential(config.protocolKeyPath);
  const fingerprintKey = createFingerprintKey(
    loadCredential(config.fingerprintKeyPath),
    config.fingerprintKeyVersion
  );
  let stagingKey: EnvelopeKey;
  let snapshotKey: EnvelopeKey;
  try {
    [stagingKey, snapshotKey] = await Promise.all([
      loadEnvelopeKey({
        path: config.stagingKeyPath,
        purpose: 'staging',
        keyId: config.stagingKeyId,
        keyVersion: config.stagingKeyVersion
      }),
      loadEnvelopeKey({
        path: config.snapshotKeyPath,
        purpose: 'snapshot',
        keyId: config.snapshotKeyId,
        keyVersion: config.snapshotKeyVersion
      })
    ]);
  } catch {
    throw new ConfigAgentStartupError('CONFIG_AGENT_KEY_READ_FAILED');
  }
  assertKeySeparation(protocolKey, fingerprintKey.secret, [stagingKey, snapshotKey]);
  const inventoryService = createInventoryService({
    catalog: loaded.catalog,
    manifest: loaded.manifest,
    fingerprintKey
  });
  const configuredHandlers =
    dependencies.changeHandlers ??
    (config.draftEnabled || config.runtimeApplyEnabled || config.buildApplyEnabled
      ? createRuntimeMutationHandlers({
          config,
          loaded,
          fingerprintKey,
          stagingKey,
          snapshotKey
        })
      : undefined);
  const changeHandlers = enabledChangeHandlers(config, configuredHandlers);
  const server = createAuthenticatedServer({
    socketPath: config.socketPath,
    socketGroup: config.socketGroup,
    protocolKey,
    protocolKeyId: config.protocolKeyId,
    fingerprintKey,
    loaded,
    inventoryService,
    ...(changeHandlers ? { changeHandlers } : {}),
    clockSkewMs: config.clockSkewMs,
    requestTtlMs: config.requestTtlMs
  });
  await server.start();
  return { config, server };
}

async function main(): Promise<void> {
  try {
    await startConfigAgent();
  } catch (error) {
    const code =
      error instanceof ConfigAgentStartupError ||
      (error instanceof Error && 'code' in error && typeof error.code === 'string')
        ? error.code
        : 'CONFIG_AGENT_START_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main();
}
