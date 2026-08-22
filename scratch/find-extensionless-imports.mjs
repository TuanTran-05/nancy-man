/** Tìm import quan hệ thiếu đuôi .js — chạy được khi typecheck/test, chết lúc runtime ESM. */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const bad = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|\.git|worktrees/.test(p)) walk(p);
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;

    const src = readFileSync(p, 'utf8');
    // Bỏ qua `import type` — nó bị xoá lúc biên dịch nên không ảnh hưởng runtime.
    const re = /^\s*(?:import|export)\s+(?!type\s)([^;]*?)\s+from\s+['"](\.[^'"]*)['"]/gm;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[2];
      if (spec.endsWith('.js') || spec.endsWith('.json')) continue;
      bad.push(`${p.split(path.sep).join('/')}  ->  ${spec}`);
    }
  }
}

for (const root of process.argv.slice(2)) walk(root);

console.log(bad.length ? bad.join('\n') : '(khong co)');
console.log('\ntong:', bad.length);
