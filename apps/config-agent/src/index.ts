import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createFingerprintKey } from './inventory/fingerprint.js';
import { createInventoryService } from './inventory/inventoryService.js';
import { loadCatalogAndManifest } from './manifestLoader.js';
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
  | 'CONFIG_AGENT_START_FAILED';

export type ConfigAgentStartDependencies = Readonly<{
  changeHandlers?: AgentMutationHandlers;
}>;

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
  const inventoryService = createInventoryService({
    catalog: loaded.catalog,
    manifest: loaded.manifest,
    fingerprintKey
  });
  const server = createAuthenticatedServer({
    socketPath: config.socketPath,
    socketGroup: config.socketGroup,
    protocolKey,
    protocolKeyId: config.protocolKeyId,
    fingerprintKey,
    loaded,
    inventoryService,
    ...(dependencies.changeHandlers ? { changeHandlers: dependencies.changeHandlers } : {}),
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
