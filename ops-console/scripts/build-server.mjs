import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist/server', { recursive: true });
await build({
  entryPoints: {
    'collector-main': 'src/server/collector/collector-main.ts',
    'failsafe-main': 'src/server/alerts/failsafe-main.ts',
    'web-server': 'src/server/http/web-server.ts',
    'collector-entry': 'src/server/collector/collector-entry.ts',
    'failsafe-entry': 'src/server/alerts/failsafe-entry.ts',
    'web-entry': 'src/server/http/web-entry.ts',
    'provision-ops-user': 'src/cli/provision-ops-user.ts',
    'smoke-beszel': 'src/cli/smoke-beszel.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: 'dist/server',
  packages: 'external',
  sourcemap: false,
});
