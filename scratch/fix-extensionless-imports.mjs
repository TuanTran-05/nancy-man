/** Thêm đuôi .js cho mọi import/export quan hệ còn thiếu, theo quy ước của repo. */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

let changed = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|\.git|worktrees/.test(p)) walk(p);
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;

    const src = readFileSync(p, 'utf8');
    const next = src.replace(
      /(\sfrom\s+['"])(\.[^'"]*)(['"])/g,
      (full, head, spec, tail) =>
        spec.endsWith('.js') || spec.endsWith('.json') ? full : `${head}${spec}.js${tail}`
    );
    if (next !== src) {
      writeFileSync(p, next);
      changed++;
      console.log('sua:', p.split(path.sep).join('/'));
    }
  }
}

for (const root of process.argv.slice(2)) walk(root);
console.log('\nso file da sua:', changed);
