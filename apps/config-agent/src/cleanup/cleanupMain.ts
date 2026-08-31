import { pathToFileURL } from 'node:url';

import { RetentionService } from './retentionService.js';
import { readConfigAgentRuntimeConfig } from '../runtimeConfig.js';

export async function runConfigAgentCleanup(environment: NodeJS.ProcessEnv = process.env) {
  const config = readConfigAgentRuntimeConfig(environment);
  const service = new RetentionService({ stateDirectory: config.stateDirectory });
  return service.cleanup();
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void runConfigAgentCleanup().catch(() => {
    process.stderr.write('CONFIG_AGENT_CLEANUP_FAILED\n');
    process.exitCode = 1;
  });
}
