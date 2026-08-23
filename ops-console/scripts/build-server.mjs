import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist/server', { recursive: true });
await build({
  entryPoints: {
    'collector-main': 'src/server/collector/collector-main.ts',
    'failsafe-main': 'src/server/alerts/failsafe-main.ts',
    'web-server': 'src/server/http/web-server.ts',
    'provision-ops-user': 'src/cli/provision-ops-user.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: 'dist/server',
  packages: 'external',
  sourcemap: false,
});
