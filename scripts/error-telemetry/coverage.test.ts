import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isProductionSourcePath,
  productionSourceFiles,
  scanSource,
  sourceHasProvisionalRuntimeCapture
} from './coverage.js';
import { migrateFiles, migrateSource } from './migrate.js';

describe('error telemetry coverage', () => {
  const nodeImport = "import { captureOpsException } from '../telemetry/runtimeTelemetry.js';\n";

  it('requires capture for Promise catch callbacks that absorb a rejection', () => {
    expect(scanSource('job().catch(() => undefined)', 'worker.ts')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_PROMISE_REJECTION' })
    ]);
  });

  it('limits production coverage to Ops app and package runtime source', () => {
    expect(isProductionSourcePath('apps/api/src/index.ts')).toBe(true);
    expect(isProductionSourcePath('packages/db/src/migrate.ts')).toBe(true);
    expect(isProductionSourcePath('apps/api/src/index.test.ts')).toBe(false);
    expect(isProductionSourcePath('apps/web/src/web/telemetry/runtimeTelemetry.ts')).toBe(false);
    expect(isProductionSourcePath('apps/api/src/modules/ingest/browserIngest.ts')).toBe(false);
    expect(isProductionSourcePath('packages/security/src/telemetry/contextToken.ts')).toBe(false);
    expect(isProductionSourcePath('deploy/ops/check.ts')).toBe(false);
  });

  it.each([
    'apps/api/src/runtime/main.ts',
    'apps/processor/src/runtime/main.ts',
    'apps/notifier/src/runtime/main.ts',
    'apps/sql-worker/src/runtime/main.ts',
    'apps/config-agent/src/index.ts',
    'apps/web/src/server/http/web-server.ts',
    'apps/web/src/server/collector/collector-main.ts'
  ])('binds and unwinds the app-local runtime facade in %s', (fileName) => {
    const source = readFileSync(fileName, 'utf8');

    expect(source).toMatch(/installOpsRuntimeTelemetry\(telemetry\)/u);
    expect(source).toMatch(/disposeRuntimeTelemetry\(\)/u);
    expect(source).toMatch(/disposeNodeTelemetryLifecycle\(\)/u);
  });

  it.each([
    ['apps/sql-worker/src/index.ts', 'startOpsSqlWorker'],
    ['apps/web/src/server/collector/collector-entry.ts', 'startCollector']
  ])('keeps %s as transparent top-level propagation to its bound owner', (fileName, owner) => {
    const source = readFileSync(fileName, 'utf8');

    expect(source).toContain(`await ${owner}(`);
    expect(source).not.toMatch(/\.catch\s*\(/u);
  });

  it('accepts the canonical app-local Node capture facade', () => {
    const source = `
      import { captureOpsException } from '../telemetry/runtimeTelemetry.js';
      try {
        await work();
      } catch (error) {
        captureOpsException(error, { code: 'WORK_FAILED', source: 'job' });
        return undefined;
      }
    `;

    expect(scanSource(source, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
  });

  it('requires capture before the first recovery effect', () => {
    const late = `${nodeImport}try { work(); } catch (error) {
      console.error(error);
      captureOpsException(error, { code: 'WORK_FAILED', source: 'job' });
    }`;
    const early = `${nodeImport}try { work(); } catch (error) {
      captureOpsException(error, { code: 'WORK_FAILED', source: 'job' });
      console.error(error);
    }`;

    expect(scanSource(late, 'apps/processor/src/jobs/worker.ts')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
    expect(scanSource(early, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
  });

  it('requires evidence on every handling branch while accepting an exact rethrow', () => {
    const source = `${nodeImport}try { work(); } catch (error) {
      if (retryable) {
        captureOpsException(error, { code: 'WORK_FAILED', source: 'job' });
        return fallback();
      }
      throw error;
    }`;
    const uncovered = source.replace('throw error;', 'return undefined;');

    expect(scanSource(source, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
    expect(scanSource(uncovered, 'apps/processor/src/jobs/worker.ts')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
  });

  it('isolates a nested catch facade capture from the outer caught error', () => {
    const source = `${nodeImport}try { work(); } catch (outer) {
      captureOpsException(outer, { code: 'OUTER_FAILED', source: 'job' });
      try { recover(); } catch (inner) {
        captureOpsException(inner, { code: 'RECOVERY_FAILED', source: 'job' });
      }
    }`;

    expect(scanSource(source, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
  });

  it('treats a known facade capture of a different Error as safe work', () => {
    const source = `${nodeImport}try { report(); } catch (telemetryError) {
      captureOpsException(originalError, { code: 'ORIGINAL_FAILED', source: 'api' });
      captureOpsException(telemetryError, { code: 'TELEMETRY_FAILED', source: 'process' });
    }`;

    expect(scanSource(source, 'apps/api/src/modules/exampleRoutes.ts')).toEqual([]);
  });

  it('recognizes an injected runtime capture as terminal ownership', () => {
    const source = `try { work(); } catch (error) {
      telemetry.captureException(error, failureContext);
      return undefined;
    }`;

    expect(scanSource(source, 'apps/processor/src/index.ts')).toEqual([]);
  });

  it('does not mistake replacement throws for propagation of the original Error', () => {
    expect(
      scanSource(
        "try { work(); } catch (error) { throw new Error('replacement'); }",
        'apps/processor/src/jobs/worker.ts'
      )
    ).toEqual([expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })]);
  });

  it('accepts an exact alias rethrow without preempting an outer owner', () => {
    expect(
      scanSource(
        'try { work(); } catch (error) { const original = error; throw original; }',
        'apps/processor/src/jobs/worker.ts'
      )
    ).toEqual([]);
  });

  it('requires deferred ownership before forwarding a caught error to the outer handler', () => {
    const terminal = `${nodeImport}try { work(); } catch (error) {
      captureOpsException(error, { code: 'LOWER_GENERIC', source: 'api' });
      next(error);
    }`;
    const provisional = terminal.replace(
      "source: 'api'",
      "source: 'api', deferUntilHandled: true"
    );

    expect(scanSource(terminal, 'apps/api/src/modules/exampleRoutes.ts')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
    expect(scanSource(provisional, 'apps/api/src/modules/exampleRoutes.ts')).toEqual([]);
  });

  it('requires deferred ownership for a local facade capture before an exact rethrow', () => {
    const terminal = `${nodeImport}try { work(); } catch (error) {
      captureOpsException(error, { code: 'LOWER_GENERIC', source: 'database' });
      throw error;
    }`;
    const provisional = terminal.replace(
      "source: 'database'",
      "source: 'database', deferUntilHandled: true"
    );
    const uncertain = terminal.replace(
      "source: 'database'",
      "source: 'database', deferUntilHandled: shouldDefer"
    );

    expect(scanSource(terminal, 'apps/processor/src/jobs/worker.ts')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
    expect(scanSource(provisional, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
    expect(scanSource(uncertain, 'apps/processor/src/jobs/worker.ts')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
  });

  it.each([
    ['Node', nodeImport, 'captureOpsException', 'apps/processor/src/jobs/worker.ts'],
    [
      'browser',
      "import { captureBrowserException } from '../telemetry/runtimeTelemetry.js';\n",
      'captureBrowserException',
      'apps/web/src/web/pages/worker.tsx'
    ]
  ])(
    'detects provisional context in argument two for the %s facade',
    (_runtime, importLine, facade, filePath) => {
      const source = `${importLine}${facade}(error, {
      code: 'LOWER_FAILED',
      source: 'job',
      deferUntilHandled: true
    });`;

      expect(sourceHasProvisionalRuntimeCapture(source, filePath)).toBe(true);
    }
  );

  it('preserves an exact local capture before rethrow idempotently', () => {
    const source = `${nodeImport}try { work(); } catch (error) {
      captureOpsException(error, { code: 'LOWER_GENERIC', source: 'database' });
      throw error;
    }`;

    const first = migrateSource(source, 'apps/processor/src/jobs/worker.ts');
    expect(first.unsupported).toBeUndefined();
    expect(first.sourceText).toContain('deferUntilHandled: true');
    expect(first.changed).toBe(true);
    expect(scanSource(first.sourceText, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
    expect(migrateSource(first.sourceText, 'apps/processor/src/jobs/worker.ts')).toMatchObject({
      changed: false,
      sourceText: first.sourceText
    });
  });

  it.each([
    ['Node', 'captureOpsException', nodeImport, 'apps/processor/src/jobs/worker.ts'],
    [
      'browser',
      'captureBrowserException',
      "import { captureBrowserException } from '../telemetry/runtimeTelemetry.js';\n",
      'apps/web/src/web/pages/worker.tsx'
    ]
  ])(
    'tracks a terminalizing helper after a provisional %s capture',
    (_runtime, facade, importLine, filePath) => {
      const source = `${importLine}
        const report = (value: unknown) => ${facade}(value, { code: 'HELPER_FAILED', source: 'job' });
        try { work(); } catch (error) {
          ${facade}(error, { code: 'LOWER_FAILED', source: 'job', deferUntilHandled: true });
          try { report(error); } catch (secondary) {
            ${facade}(secondary, { code: 'REPORT_FAILED', source: 'job', distinctFrom: error });
          }
          throw error;
        }
      `;

      expect(scanSource(source, filePath)).toEqual([
        expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
      ]);
    }
  );

  it('rejects lookalike, shadowed, and incomplete facade calls', () => {
    const examples = [
      `import { captureOpsException } from '../logging.js';
       try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); }`,
      `${nodeImport}function run(captureOpsException: Function) {
        try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); }
      }`,
      `${nodeImport}try { work(); } catch (error) {
        captureOpsException(error, { code: 'FAILED' } as never);
      }`
    ];

    for (const source of examples) {
      expect(scanSource(source, 'apps/processor/src/jobs/worker.ts')).toEqual([
        expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
      ]);
    }
  });

  it('accepts namespace and aliased canonical imports', () => {
    const namespace = `import * as telemetry from '../telemetry/runtimeTelemetry.js';
      try { work(); } catch (error) {
        telemetry.captureOpsException(error, { code: 'FAILED', source: 'job' });
      }`;
    const aliased = `import { captureOpsException as report } from '../telemetry/runtimeTelemetry.js';
      try { work(); } catch (error) {
        report(error, { code: 'FAILED', source: 'job' });
      }`;

    expect(scanSource(namespace, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
    expect(scanSource(aliased, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
  });

  it('accepts only the canonical Ops browser facade in browser source', () => {
    const canonical = `import { captureBrowserException } from '../telemetry/runtimeTelemetry.js';
      try { render(); } catch (error) {
        captureBrowserException(error, { code: 'RENDER_FAILED', source: 'browser' });
      }`;
    const serverFacade = canonical.replace(
      '../telemetry/runtimeTelemetry.js',
      '../../server/telemetry/runtimeTelemetry.js'
    );

    expect(scanSource(canonical, 'apps/web/src/web/pages/dashboard.tsx')).toEqual([]);
    expect(scanSource(serverFacade, 'apps/web/src/web/pages/dashboard.tsx')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
  });

  it('does not count a capture deferred inside an uninvoked closure', () => {
    const source = `${nodeImport}try { work(); } catch (error) {
      const later = () => captureOpsException(error, { code: 'FAILED', source: 'job' });
      queueMicrotask(later);
    }`;

    expect(scanSource(source, 'apps/processor/src/jobs/worker.ts')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
  });

  it('keeps a documented ignore local to its intentional control-flow branch', () => {
    const covered = `try { parse(); } catch (error) {
      // telemetry-ignore: invalid optional probe is represented by null
      return null;
    }`;
    const uncovered = `try { parse(); } catch (error) {
      if (optional) {
        // telemetry-ignore: invalid optional probe is represented by null
        return null;
      }
      return fallback();
    }`;

    expect(scanSource(covered, 'packages/security/src/parser.ts')).toEqual([]);
    expect(scanSource(uncovered, 'packages/security/src/parser.ts')).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
  });

  it('reports Promise rejection handlers supplied as the second then callback', () => {
    expect(
      scanSource(
        'job().then((value) => value, () => undefined);',
        'apps/processor/src/jobs/worker.ts'
      )
    ).toEqual([expect.objectContaining({ rule: 'UNCAPTURED_PROMISE_REJECTION' })]);
  });

  it('migrates an anonymous Promise rejection without exposing its identity and is idempotent', () => {
    const first = migrateSource(
      'void job().catch(() => undefined);',
      'apps/processor/src/jobs/worker.ts'
    );

    expect(first.unsupported).toBeUndefined();
    expect(first.changed).toBe(true);
    expect(first.sourceText).toContain(
      "import { captureOpsException } from '../telemetry/runtimeTelemetry.js';"
    );
    expect(first.sourceText).toContain("code: 'UNHANDLED_PROMISE_REJECTION'");
    expect(first.sourceText).toContain("source: 'job'");
    expect(scanSource(first.sourceText, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
    expect(migrateSource(first.sourceText, 'apps/processor/src/jobs/worker.ts')).toMatchObject({
      changed: false,
      migratedBoundaries: 0,
      sourceText: first.sourceText
    });
  });

  it('captures a replacement error as terminal recovery of the original', () => {
    const replacementThrow = "try { work(); } catch { throw new Error('replacement'); }";

    const result = migrateSource(replacementThrow, 'apps/processor/src/jobs/worker.ts');

    expect(result.unsupported).toBeUndefined();
    expect(result.changed).toBe(true);
    expect(scanSource(result.sourceText, 'apps/processor/src/jobs/worker.ts')).toEqual([]);
  });

  it('accepts and injects the shared canonical singleton for package boundaries', () => {
    const canonical = `
      import { captureOpsException } from '../../telemetry-sdk/src/runtimeCaptureFacade.js';
      try { parse(); } catch (error) {
        captureOpsException(error, { code: 'PARSE_FAILED', source: 'database' });
        return null;
      }
    `;
    expect(scanSource(canonical, 'packages/db/src/parser.ts')).toEqual([]);

    const result = migrateSource(
      'try { read(); } catch { return null; }',
      'packages/security/src/parser.ts'
    );
    expect(result.unsupported).toBeUndefined();
    expect(result.sourceText).toContain(
      "import { captureOpsException } from '../../telemetry-sdk/src/runtimeCaptureFacade.js';"
    );
    expect(scanSource(result.sourceText, 'packages/security/src/parser.ts')).toEqual([]);
  });

  it('migrates browser and then-rejection callbacks through their canonical local facade', () => {
    const browser = migrateSource(
      'request().catch(() => setFailed(true));',
      'apps/web/src/web/pages/dashboard.tsx'
    );
    const node = migrateSource(
      'void job().then(handleSuccess, () => undefined);',
      'apps/notifier/src/runtime/queue.ts'
    );

    expect(browser.unsupported).toBeUndefined();
    expect(browser.sourceText).toContain(
      "import { captureBrowserException } from '../telemetry/runtimeTelemetry.js';"
    );
    expect(browser.sourceText).toContain("source: 'browser'");
    expect(node.unsupported).toBeUndefined();
    expect(node.sourceText).toContain(
      "import { captureOpsException } from '../telemetry/runtimeTelemetry.js';"
    );
    expect(scanSource(browser.sourceText, 'apps/web/src/web/pages/dashboard.tsx')).toEqual([]);
    expect(scanSource(node.sourceText, 'apps/notifier/src/runtime/queue.ts')).toEqual([]);
  });

  it('infers database and provider sources but refuses mixed phases', () => {
    const database = migrateSource(
      'async function run() { try { await database.query("SELECT 1"); } catch { return null; } }',
      'apps/api/src/modules/read.ts'
    );
    const provider = migrateSource(
      "async function run() { try { await fetch('https://provider.invalid'); } catch { return null; } }",
      'apps/api/src/modules/provider.ts'
    );
    const mixed = migrateSource(
      "async function run() { try { await database.query('SELECT 1'); await fetch(url); } catch { return null; } }",
      'apps/api/src/modules/mixed.ts'
    );

    expect(database.sourceText).toContain("source: 'database'");
    expect(provider.sourceText).toContain("source: 'provider'");
    expect(mixed.changed).toBe(false);
    expect(mixed.unsupported?.[0]?.reason).toContain('mixed provider and database');
  });

  it('preserves safe request ownership metadata in migrated API handlers', () => {
    const result = migrateSource(
      `async function route(req: Request, res: Response) {
        try { await loadUser(); }
        catch { return res.status(503).json({ error: 'unavailable' }); }
      }`,
      'apps/api/src/modules/users/userRoutes.ts'
    );

    expect(result.unsupported).toBeUndefined();
    expect(result.sourceText).toContain(
      "requestId: () => typeof res.locals?.requestId === 'string' ? res.locals.requestId : undefined"
    );
    expect(result.sourceText).toContain(
      "route: () => (req.originalUrl || req.url || '').split('?', 1)[0] || undefined"
    );
    expect(result.sourceText).toContain('method: () => req.method');
    expect(result.sourceText).toContain('status: 500');
    expect(scanSource(result.sourceText, 'apps/api/src/modules/users/userRoutes.ts')).toEqual([]);
  });
});

describe('scanner control-flow regression matrix', () => {
  const captureImport = "import { captureOpsException } from '../telemetry/runtimeTelemetry.js';\n";
  const capture = "captureOpsException(error, { code: 'WORK_FAILED', source: 'job' });";
  const filePath = 'apps/processor/src/jobs/matrix.ts';

  it.each([
    [
      'direct terminal capture',
      `${captureImport}try { work(); } catch (error) { ${capture} return null; }`
    ],
    ['exact original rethrow', 'try { work(); } catch (error) { throw error; }'],
    [
      'immutable alias rethrow',
      'try { work(); } catch (error) { const original = error; throw original; }'
    ],
    [
      'all if branches owned',
      `${captureImport}try { work(); } catch (error) { if (known) { ${capture} return null; } throw error; }`
    ],
    [
      'all switch branches owned',
      `${captureImport}try { work(); } catch (error) { switch (kind) { case 'retry': throw error; case 'known': ${capture} return null; default: ${capture} return undefined; } }`
    ],
    [
      'capture before later recovery effects',
      `${captureImport}try { work(); } catch (error) { ${capture} console.error(error); return null; }`
    ],
    [
      'capture in return finalizer',
      `${captureImport}function run() { try { work(); } catch (error) { try { return null; } finally { ${capture} } } }`
    ],
    [
      'capture in labeled break finalizer',
      `${captureImport}outer: { try { work(); } catch (error) { try { break outer; } finally { ${capture} } } }`
    ],
    [
      'capture in continue finalizer',
      `${captureImport}outer: for (;;) { try { work(); } catch (error) { try { continue outer; } finally { ${capture} } } }`
    ],
    [
      'branch-local ignore plus owned sibling',
      `${captureImport}try { work(); } catch (error) { if (expected) { // telemetry-ignore: expected capability probe\n return null; } else { ${capture} return undefined; } }`
    ],
    [
      'provisional exact propagation',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: 'LOWER_FAILED', source: 'job', deferUntilHandled: true }); throw error; }`
    ],
    [
      'inert deferred closure after provisional capture',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: 'LOWER_FAILED', source: 'job', deferUntilHandled: true }); const later = () => captureOpsException(error, { code: 'LATE_FAILED', source: 'job' }); void later; throw error; }`
    ],
    [
      'namespace facade import',
      "import * as telemetry from '../telemetry/runtimeTelemetry.js'; try { work(); } catch (error) { telemetry.captureOpsException(error, { code: 'FAILED', source: 'job' }); }"
    ],
    [
      'renamed facade import',
      "import { captureOpsException as report } from '../telemetry/runtimeTelemetry.js'; try { work(); } catch (error) { report(error, { code: 'FAILED', source: 'job' }); }"
    ],
    [
      'strict metadata expressions',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: mode === 'x' ? 'X_FAILED' : 'Y_FAILED', source: 'job', route: route || '/unknown' }); }`
    ]
  ])('accepts %s', (_name, source) => {
    expect(scanSource(source, filePath)).toEqual([]);
  });

  it.each([
    [
      'capture after logging',
      `${captureImport}try { work(); } catch (error) { console.error(error); ${capture} }`
    ],
    [
      'capture after recovery call',
      `${captureImport}try { work(); } catch (error) { fallback(error); ${capture} }`
    ],
    [
      'uncovered if branch',
      `${captureImport}try { work(); } catch (error) { if (known) { ${capture} return null; } return fallback(); }`
    ],
    [
      'uncovered switch default',
      `${captureImport}try { work(); } catch (error) { switch (kind) { case 'known': ${capture} return null; default: return fallback(); } }`
    ],
    [
      'capture only in ternary arm',
      `${captureImport}try { work(); } catch (error) { return known ? (${capture.replace(';', '')}, null) : fallback(); }`
    ],
    [
      'capture only through logical and',
      `${captureImport}try { work(); } catch (error) { known && ${capture} return null; }`
    ],
    [
      'capture only through logical or',
      `${captureImport}try { work(); } catch (error) { known || ${capture} return null; }`
    ],
    [
      'capture in possibly-empty loop',
      `${captureImport}try { work(); } catch (error) { while (retry) { ${capture} break; } return null; }`
    ],
    [
      'nested early return before capture',
      `${captureImport}try { work(); } catch (error) { try { if (retry) return null; } finally { cleanup(); } ${capture} }`
    ],
    [
      'iteration after provisional capture',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: 'LOWER_FAILED', source: 'job', deferUntilHandled: true }); for (const item of iterable) consume(item); throw error; }`
    ],
    [
      'effectful finalizer after provisional rethrow',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: 'LOWER_FAILED', source: 'job', deferUntilHandled: true }); try { throw error; } finally { cleanup(); } }`
    ],
    [
      'enclosing effectful finalizer',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: 'LOWER_FAILED', source: 'job', deferUntilHandled: true }); throw error; } finally { cleanup(); }`
    ],
    [
      'abrupt finalizer replaces propagation',
      `${captureImport}function run() { try { work(); } catch (error) { captureOpsException(error, { code: 'LOWER_FAILED', source: 'job', deferUntilHandled: true }); try { throw error; } finally { return null; } } }`
    ],
    [
      'capture in uninvoked closure',
      `${captureImport}try { work(); } catch (error) { const later = () => { ${capture} }; queueMicrotask(later); return null; }`
    ],
    [
      'rethrow in deferred closure',
      'try { work(); } catch (error) { queueMicrotask(() => { throw error; }); return null; }'
    ],
    [
      'mutable alias capture',
      `${captureImport}try { work(); } catch (error) { let original = error; captureOpsException(original, { code: 'FAILED', source: 'job' }); }`
    ],
    [
      'reassigned alias capture',
      `${captureImport}try { work(); } catch (error) { let original = error; original = replacement; captureOpsException(original, { code: 'FAILED', source: 'job' }); }`
    ],
    [
      'reassigned caught binding',
      `${captureImport}try { work(); } catch (error) { error = replacement; ${capture} }`
    ],
    [
      'replacement capture argument',
      `${captureImport}try { work(); } catch (error) { captureOpsException(new Error('replacement'), { code: 'FAILED', source: 'job' }); }`
    ],
    [
      'missing source contract',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED' } as never); }`
    ],
    [
      'overridable provisional spread',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job', deferUntilHandled: true, ...options }); throw error; }`
    ],
    [
      'dynamic provisional flag',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job', deferUntilHandled: shouldDefer }); throw error; }`
    ],
    [
      'effectful capture metadata',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { code: computeCode(), source: 'job' }); }`
    ],
    [
      'accessor capture metadata',
      `${captureImport}try { work(); } catch (error) { captureOpsException(error, { get code() { return 'FAILED'; }, source: 'job' }); }`
    ],
    [
      'type-only canonical import',
      "import type { captureOpsException } from '../telemetry/runtimeTelemetry.js'; try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); }"
    ],
    [
      'specifier type-only canonical import',
      "import { type captureOpsException } from '../telemetry/runtimeTelemetry.js'; try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); }"
    ],
    [
      'wrong-module lookalike',
      "import { captureOpsException } from '../logging/runtimeTelemetry.js'; try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); }"
    ],
    [
      'canonical-suffix lookalike',
      "import { captureOpsException } from '../fake/telemetry/runtimeTelemetry.js'; try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); }"
    ],
    [
      'parameter-shadowed facade',
      `${captureImport}function run(captureOpsException: Function) { try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); } }`
    ],
    [
      'function-hoisted var facade shadow',
      `${captureImport}function run() { if (replace) { var captureOpsException = applicationCapture; } try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); } }`
    ],
    [
      'namespace facade shadow',
      `${captureImport}namespace Feature { const captureOpsException = applicationCapture; export function run() { try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); } } }`
    ],
    [
      'CaseBlock facade shadow',
      `${captureImport}switch (kind) { case 'replace': let captureOpsException = applicationCapture; break; default: try { work(); } catch (error) { captureOpsException(error, { code: 'FAILED', source: 'job' }); } }`
    ],
    [
      'comment-only facade text',
      "try { work(); } catch (error) { // captureOpsException(error, { code: 'NOPE', source: 'job' });\n return null; }"
    ],
    ['empty ignore reason', 'try { work(); } catch { // telemetry-ignore:\n return null; }'],
    [
      'malformed ignore marker',
      'try { work(); } catch { // telemetry-ignore expected probe\n return null; }'
    ],
    [
      'ignore leaks past local block',
      'try { work(); } catch (error) { { // telemetry-ignore: local capability probe\n void 0; } return fallback(error); }'
    ],
    [
      'ignore before effectful predicate',
      'try { work(); } catch (error) { // telemetry-ignore: expected capability probe\n if (classify(error)) return null; throw error; }'
    ],
    [
      'ignore before effectful return expression',
      'try { work(); } catch (error) { // telemetry-ignore: expected capability probe\n return fallback(error); }'
    ],
    ['anonymous recovery catch', 'try { work(); } catch { return null; }']
  ])('reports %s', (_name, source) => {
    expect(scanSource(source, filePath)).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_CATCH' })
    ]);
  });
});

describe('scanner Promise rejection regression matrix', () => {
  const captureImport = "import { captureOpsException } from '../telemetry/runtimeTelemetry.js';\n";
  const filePath = 'apps/processor/src/jobs/promise-matrix.ts';

  it.each([
    ['catch arrow fallback', 'task.catch((error) => fallback(error));'],
    ['catch anonymous fallback', 'task.catch(() => fallback());'],
    ['catch block fallback', 'task.catch((error) => { console.error(error); return null; });'],
    ['then second callback', 'task.then(onSuccess, (error) => fallback(error));'],
    ['then anonymous second callback', 'task.then(onSuccess, () => undefined);'],
    ['referenced catch handler', 'task.catch(onRejected);'],
    ['referenced then handler', 'task.then(onSuccess, onRejected);'],
    ['member catch handler', 'task.catch(handlers.onRejected);'],
    ['member then handler', 'task.then(onSuccess, handlers.onRejected);'],
    ['computed catch', "task['catch']((error) => fallback(error));"],
    ['template computed catch', 'task[`catch`]((error) => fallback(error));'],
    ['wrapped computed catch', "task[('catch')]((error) => fallback(error));"],
    ['cast computed catch', "task['catch' as const]((error) => fallback(error));"],
    ['optional catch call', 'task.catch?.((error) => fallback(error));'],
    ['generator catch callback', 'task.catch(function* (error) { throw error; });'],
    ['async generator catch callback', 'task.catch(async function* (error) { throw error; });'],
    [
      'factory-produced catch callback',
      'task.catch(((seed: unknown) => (error: unknown) => fallback(error))(input));'
    ],
    [
      'nested callback only covers inner rejection',
      'outer.catch((outerError) => { inner.catch((innerError) => { throw innerError; }); return null; });'
    ],
    ['rest rejection binding', 'task.catch((...errors) => { throw errors; });'],
    [
      'defaulted rejection binding',
      "task.catch((error = new Error('replacement')) => { throw error; });"
    ],
    ['destructured rejection binding', 'task.catch(({ message }) => { throw message; });'],
    [
      'replacement captured in callback',
      `${captureImport}task.catch((error) => captureOpsException(new Error('replacement'), { code: 'FAILED', source: 'job' }));`
    ],
    [
      'recovery precedes callback capture',
      `${captureImport}task.catch((error) => { console.error(error); captureOpsException(error, { code: 'FAILED', source: 'job' }); });`
    ]
  ])('reports %s', (_name, source) => {
    expect(scanSource(source, filePath)).toEqual([
      expect.objectContaining({ rule: 'UNCAPTURED_PROMISE_REJECTION' })
    ]);
  });

  it.each([
    ['exact catch rethrow', 'task.catch((error) => { throw error; });'],
    [
      'terminal catch capture',
      `${captureImport}task.catch((error) => captureOpsException(error, { code: 'FAILED', source: 'job' }));`
    ],
    [
      'terminal then rejection capture',
      `${captureImport}task.then(onSuccess, (error) => { captureOpsException(error, { code: 'FAILED', source: 'job' }); return null; });`
    ],
    [
      'aliased rejection capture',
      `${captureImport}task.catch((error) => { const original = error; captureOpsException(original, { code: 'FAILED', source: 'job' }); });`
    ],
    ['computed exact catch rethrow', "task['catch']((error) => { throw error; });"]
  ])('accepts %s', (_name, source) => {
    expect(scanSource(source, filePath)).toEqual([]);
  });
});

describe('error telemetry migrator regression matrix', () => {
  it.each([
    [
      'API catch',
      'apps/api/src/modules/example.ts',
      'try { work(); } catch { return null; }',
      "from '../telemetry/runtimeTelemetry.js'"
    ],
    [
      'processor catch',
      'apps/processor/src/jobs/example.ts',
      'try { work(); } catch { return null; }',
      "from '../telemetry/runtimeTelemetry.js'"
    ],
    [
      'notifier catch',
      'apps/notifier/src/channels/example.ts',
      'try { work(); } catch { return null; }',
      "from '../telemetry/runtimeTelemetry.js'"
    ],
    [
      'SQL worker catch',
      'apps/sql-worker/src/execution/example.ts',
      'try { work(); } catch { return null; }',
      "from '../telemetry/runtimeTelemetry.js'"
    ],
    [
      'config agent catch',
      'apps/config-agent/src/changes/example.ts',
      'try { work(); } catch { return null; }',
      "from '../telemetry/runtimeTelemetry.js'"
    ],
    [
      'web server catch',
      'apps/web/src/server/alerts/example.ts',
      'try { work(); } catch { return null; }',
      "from '../telemetry/runtimeTelemetry.js'"
    ],
    [
      'web browser catch',
      'apps/web/src/web/pages/example.tsx',
      'try { render(); } catch { return null; }',
      "from '../telemetry/runtimeTelemetry.js'"
    ],
    [
      'database package catch',
      'packages/db/src/example.ts',
      'try { work(); } catch { return null; }',
      "from '../../telemetry-sdk/src/runtimeCaptureFacade.js'"
    ],
    [
      'security package catch',
      'packages/security/src/example.ts',
      'try { work(); } catch { return null; }',
      "from '../../telemetry-sdk/src/runtimeCaptureFacade.js'"
    ],
    [
      'anonymous catch with occupied error binding',
      'apps/processor/src/jobs/occupied.ts',
      'try { work(); } catch { const error = previous; return null; }',
      'catch (errorTelemetry)'
    ],
    [
      'expression Promise catch',
      'apps/processor/src/jobs/promise.ts',
      'void work().catch(() => undefined);',
      "code: 'UNHANDLED_PROMISE_REJECTION'"
    ],
    [
      'block Promise catch',
      'apps/processor/src/jobs/promise-block.ts',
      'void work().catch(() => { return undefined; });',
      "code: 'UNHANDLED_PROMISE_REJECTION'"
    ],
    [
      'then rejection callback',
      'apps/notifier/src/channels/promise.ts',
      'void work().then(onSuccess, () => undefined);',
      "code: 'UNHANDLED_PROMISE_REJECTION'"
    ],
    [
      'computed Promise catch',
      'apps/config-agent/src/changes/promise.ts',
      "void work()['catch'](() => undefined);",
      "code: 'UNHANDLED_PROMISE_REJECTION'"
    ],
    [
      'browser Promise catch',
      'apps/web/src/web/pages/promise.tsx',
      'void request().catch(() => setFailed(true));',
      "source: 'browser'"
    ]
  ])(
    'migrates %s through its canonical facade and remains idempotent',
    (_name, filePath, source, marker) => {
      const first = migrateSource(source, filePath);

      expect(first.unsupported).toBeUndefined();
      expect(first.changed).toBe(true);
      expect(first.sourceText).toContain(marker);
      expect(scanSource(first.sourceText, filePath)).toEqual([]);
      expect(migrateSource(first.sourceText, filePath)).toMatchObject({
        changed: false,
        migratedBoundaries: 0,
        sourceText: first.sourceText
      });
    }
  );

  it.each([
    [
      'logs the caught identity during recovery',
      'try { work(); } catch (error) { console.error(error); return null; }'
    ],
    [
      'passes the caught identity to recovery',
      'try { work(); } catch (error) { return fallback(error); }'
    ]
  ])('captures before recovery that retains the caught identity: %s', (_name, source) => {
    const result = migrateSource(source, 'apps/processor/src/jobs/recovery.ts');

    expect(result.unsupported).toBeUndefined();
    expect(result.changed).toBe(true);
    expect(result.sourceText).toContain("captureOpsException(error, {");
    expect(scanSource(result.sourceText, 'apps/processor/src/jobs/recovery.ts')).toEqual([]);
  });

  it('captures before a guarded exact rethrow and recovery branch', () => {
    const result = migrateSource(
      'try { work(); } catch (error) { if (retry) throw error; return fallback(error); }',
      'apps/processor/src/jobs/recovery.ts'
    );

    expect(result.unsupported).toBeUndefined();
    expect(result.sourceText).toContain('deferUntilHandled: true');
    expect(result.sourceText.match(/captureOpsException\(error, \{/gu)).toHaveLength(1);
    expect(scanSource(result.sourceText, 'apps/processor/src/jobs/recovery.ts')).toEqual([]);
  });

  it.each([
    ['direct eval identity escape', 'try { work(); } catch (error) { eval(source); return null; }'],
    ['destructured catch binding', 'try { work(); } catch ({ message }) { return null; }'],
    ['rest Promise rejection binding', 'work().catch((...errors) => fallback(errors));'],
    [
      'defaulted Promise rejection binding',
      "work().catch((error = new Error('replacement')) => fallback(error));"
    ],
    ['destructured Promise rejection binding', 'work().catch(({ message }) => fallback(message));'],
    ['generator Promise rejection callback', 'work().catch(function* (error) { return error; });'],
    ['referenced Promise rejection handler', 'work().catch(onRejected);'],
    ['member Promise rejection handler', 'work().catch(handlers.onRejected);'],
    [
      'factory-produced Promise rejection handler',
      'work().catch(((seed: unknown) => (error: unknown) => fallback(error))(input));'
    ],
    [
      'function callback arguments escape',
      'work().catch(function () { return fallback(arguments[0]); });'
    ],
    [
      'mixed provider and database phase',
      "try { await database.query('SELECT 1'); await fetch(url); } catch { return null; }"
    ]
  ])('leaves unsafe %s byte-identical for manual ownership', (_name, source) => {
    const result = migrateSource(source, 'apps/processor/src/jobs/unsafe.ts');

    expect(result.changed).toBe(false);
    expect(result.sourceText).toBe(source);
    expect(result.unsupported).toEqual([expect.objectContaining({ reason: expect.any(String) })]);
  });

  it('inserts imports after module directives and reuses a canonical alias', () => {
    const withDirective = migrateSource(
      `'use strict';\ntry { work(); } catch { return null; }`,
      'apps/processor/src/jobs/directive.ts'
    );
    const withAlias = migrateSource(
      `import { captureOpsException as report } from '../telemetry/runtimeTelemetry.js';\ntry { work(); } catch { return null; }`,
      'apps/processor/src/jobs/alias.ts'
    );

    expect(withDirective.sourceText.indexOf("'use strict';")).toBeLessThan(
      withDirective.sourceText.indexOf('import { captureOpsException }')
    );
    expect(withAlias.sourceText).toContain('report(error, {');
    expect(withAlias.sourceText.match(/from '..\/telemetry\/runtimeTelemetry\.js'/gu)).toHaveLength(
      1
    );
  });

  it('preserves untouched CRLF bytes and avoids trailing whitespace in comment-only catches', () => {
    const crlf =
      'const before = 1;\r\ntry { work(); } catch {\r\n  // recover\r\n  return null;\r\n}\r\nconst after = 2;\r\n';
    const result = migrateSource(crlf, 'apps/processor/src/jobs/crlf.ts');

    expect(result.unsupported).toBeUndefined();
    expect(result.sourceText).toContain('const before = 1;\r\n');
    expect(result.sourceText).toContain('const after = 2;\r\n');
    expect(result.sourceText).not.toMatch(/[ \t]+$/mu);
    expect(scanSource(result.sourceText, 'apps/processor/src/jobs/crlf.ts')).toEqual([]);
  });

  it('validates every candidate before write mode changes any file', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ops-telemetry-atomic-'));
    const safe = path.join(root, 'apps/processor/src/jobs/a-safe.ts');
    const unsafe = path.join(root, 'apps/processor/src/jobs/b-unsafe.ts');
    const safeSource = 'try { work(); } catch { return null; }';
    const unsafeSource = 'try { work(); } catch (error) { eval(source); return null; }';
    try {
      mkdirSync(path.dirname(safe), { recursive: true });
      writeFileSync(safe, safeSource);
      writeFileSync(unsafe, unsafeSource);

      const result = await migrateFiles([safe, unsafe], { root, write: true });

      expect(result.changedFiles).toEqual([]);
      expect(result.unsupported).not.toHaveLength(0);
      expect(readFileSync(safe, 'utf8')).toBe(safeSource);
      expect(readFileSync(unsafe, 'utf8')).toBe(unsafeSource);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes verified migrations while retaining unsupported boundaries in explicit partial mode', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ops-telemetry-partial-'));
    const safe = path.join(root, 'apps/processor/src/jobs/a-safe.ts');
    const unsafe = path.join(root, 'apps/processor/src/jobs/b-unsafe.ts');
    const safeSource = 'try { work(); } catch { return null; }';
    const unsafeSource = 'try { work(); } catch (error) { eval(source); return null; }';
    try {
      mkdirSync(path.dirname(safe), { recursive: true });
      writeFileSync(safe, safeSource);
      writeFileSync(unsafe, unsafeSource);

      const result = await migrateFiles([safe, unsafe], { root, write: true, partial: true });

      expect(result.changedFiles).toEqual(['apps/processor/src/jobs/a-safe.ts']);
      expect(result.unsupported).not.toHaveLength(0);
      expect(scanSource(readFileSync(safe, 'utf8'), 'apps/processor/src/jobs/a-safe.ts')).toEqual([]);
      expect(readFileSync(unsafe, 'utf8')).toBe(unsafeSource);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('discovers only production app/package source in stable order', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ops-telemetry-scope-'));
    try {
      const paths = [
        'apps/processor/src/z.ts',
        'apps/api/src/a.ts',
        'packages/db/src/m.ts',
        'apps/api/src/a.test.ts',
        'packages/db/dist/generated.ts'
      ];
      for (const relative of paths) {
        const absolute = path.join(root, relative);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, 'export {};');
      }

      const discovered = (await productionSourceFiles(root)).map((file) =>
        path.relative(root, file).replaceAll(path.sep, '/')
      );

      expect(discovered).toEqual([
        'apps/api/src/a.ts',
        'apps/processor/src/z.ts',
        'packages/db/src/m.ts'
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('error telemetry real CLI execution', () => {
  const script = path.resolve('scripts/error-telemetry/migrate.ts');

  function cliFixture(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'ops-telemetry-cli-'));
    for (const relative of [
      'apps/api/src/modules/api.ts',
      'apps/processor/src/jobs/processor.ts',
      'apps/web/src/server/http/server.ts',
      'apps/web/src/web/pages/browser.tsx',
      'packages/db/src/database.ts'
    ]) {
      const absolute = path.join(root, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, 'try { work(); } catch { return null; }');
    }
    return root;
  }

  it.each([
    ['api', 'apps/api/src/modules/api.ts'],
    ['processor', 'apps/processor/src/jobs/processor.ts'],
    ['web-server', 'apps/web/src/server/http/server.ts'],
    ['web-browser', 'apps/web/src/web/pages/browser.tsx'],
    ['packages', 'packages/db/src/database.ts']
  ])('executes native TypeScript dry-run for the %s family', (family, expectedPath) => {
    const root = cliFixture();
    try {
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', script, '--family', family],
        { cwd: root, encoding: 'utf8', timeout: 30_000 }
      );

      expect(result.error).toBeUndefined();
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(expectedPath);
      expect(result.stdout).toContain('Would migrate 1 boundaries in 1 files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['server', 'staff', 'esp'])('rejects legacy Platform family %s', (family) => {
    const root = cliFixture();
    try {
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', script, '--family', family],
        { cwd: root, encoding: 'utf8', timeout: 30_000 }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('--family must be one of');
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('error telemetry package scripts', () => {
  it('exposes native scanner/migrator commands and runs the scanner in the CI lint gate', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['check:error-telemetry']).toBe(
      'node --experimental-strip-types scripts/error-telemetry/coverage.ts'
    );
    expect(packageJson.scripts?.['migrate:error-telemetry']).toBe(
      'node --experimental-strip-types scripts/error-telemetry/migrate.ts'
    );
    expect(packageJson.scripts?.lint).toMatch(/^npm run check:error-telemetry && /u);
  });
});
