import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeAppProcess } from './processProbe.js';

describe('process probe', () => {
  it('validates a decimal pid through proc files without shelling out', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-proc-'));
    writeFileSync(join(directory, 'app.pid'), '1234\n');
    writeFileSync(join(directory, '1234.stat'), '1234 (node) S 1 2 3');
    writeFileSync(join(directory, '1234.status'), 'Name:\tnode\nVmRSS:\t42 kB\n');
    const sample = probeAppProcess({ pidFile: join(directory, 'app.pid'), procRoot: directory });
    expect(sample.level).toBe('critical');
    expect(sample.errorCode).toBe('process_unavailable');
  });

  it('reports the current process from /proc', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-proc-'));
    writeFileSync(join(directory, 'app.pid'), `${process.pid}\n`);
    expect(probeAppProcess({ pidFile: join(directory, 'app.pid') }).monitor).toBe('app_process');
  });
});
