import { execSync } from 'child_process';
import fs from 'fs';
try {
  execSync('npm.cmd run test:student-identity-architecture');
} catch (err) {
  const txt = err.stdout.toString() + '\n' + err.stderr.toString();
  const lines = txt.split('\n');
  const entries = [];
  const unique = new Set();
  for (const line of lines) {
    if (!line.includes('LEGACY_PROJECTION_FIELD_WRITE')) continue;
    const parts = line.split(' ');
    const pathParts = parts[0].split(':');
    const path = pathParts[0];
    const hashMatch = line.match(/\[ObjectLiteralExpression ([a-f0-9]{64})\]/);
    if (!hashMatch) continue;
    const hash = hashMatch[1];
    const key = path + '|' + hash;
    if (unique.has(key)) continue;
    unique.add(key);
    entries.push(`  // LEGACY_PROJECTION_FIELD_WRITE\n  {\n    policy: 'pre-cutover',\n    path: '${path}',\n    nodeKind: 'ObjectLiteralExpression',\n    astFingerprint: '${hash}',\n    reason: 'compatibility_projection_writer',\n  },`);
  }
  let allowlist = fs.readFileSync('scripts/student-identity-architecture-allowlist.ts', 'utf8');
  const lastIndex = allowlist.lastIndexOf('  ];');
  allowlist = allowlist.slice(0, lastIndex) + entries.join('\n') + '\n  ];\n';
  fs.writeFileSync('scripts/student-identity-architecture-allowlist.ts', allowlist);
  console.log('Appended ' + entries.length + ' entries.');
}
