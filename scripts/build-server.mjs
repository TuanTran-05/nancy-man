import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const outdir = path.join(root, 'dist-server');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'server', 'index.ts')],
  outfile: path.join(outdir, 'index.js'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
});

// Hai file nay duoc mo bang new URL('./templates/...', import.meta.url). Sau
// khi bundle, import.meta.url nam tai dist-server/index.js.
await cp(
  path.join(root, 'server', 'api', 'classes', 'records', 'templates'),
  path.join(outdir, 'templates'),
  { recursive: true }
);
