import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeEvidenceJson,
  buildFrozenOpsCapture,
  captureGeneratedRoot,
  captureTrackedGitInventory,
  deterministicJson,
  validateOpsInputs,
  validateOpsDisposition,
  validateOpsDispositionForConstruction,
  validateFinalOpsDisposition
} from './opsDisposition.mjs';

const capturedAt = '2026-08-30T05:17:12.000Z';
const sha40 = '1'.repeat(40);
const sha64 = '2'.repeat(64);
const SCRIPT_PATH = path.resolve(import.meta.dirname, 'opsDisposition.mjs');
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..');
const REVIEWED_INPUT_PATH = path.join(
  REPOSITORY_ROOT,
  'docs/architecture/baselines/2026-08-29-ops-consolidation-inputs.json'
);
const REVIEWED_LEDGER_PATH = path.join(
  REPOSITORY_ROOT,
  'docs/architecture/baselines/2026-08-29-ops-disposition-ledger.json'
);

function pendingEntry(sourcePath = 'ops-console/src/web/App.tsx') {
  return {
    sourceAlias: 'embedded-console',
    sourceKind: 'git-blob' as const,
    sourcePath,
    sourceGitBlobSha: sha40,
    sourceSha256: sha64,
    targetRepository: 'edutrack-ops' as const,
    targetPath: null,
    targetGitBlobSha: null,
    targetContentSha256: null,
    disposition: 'pending' as const,
    replacementSha: null,
    evidence: ['docs/architecture/baselines/2026-08-29-ops-consolidation-inputs.json'],
    evidenceIdentities: [],
    capturedAt
  };
}

function git(repositoryRoot: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function repositoryFixture() {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'ops-disposition-git-'));
  git(repositoryRoot, 'init', '-b', 'main');
  git(repositoryRoot, 'config', 'user.name', 'Ops Test');
  git(repositoryRoot, 'config', 'user.email', 'ops-test@example.invalid');
  mkdirSync(path.join(repositoryRoot, 'ops-console/src'), { recursive: true });
  writeFileSync(path.join(repositoryRoot, 'ops-console/src/alpha.txt'), 'alpha\n');
  writeFileSync(path.join(repositoryRoot, 'ops-console/src/beta.txt'), 'beta\n');
  git(repositoryRoot, 'add', '.');
  git(repositoryRoot, 'commit', '-m', 'fixture');
  const commitSha = git(repositoryRoot, 'rev-parse', 'HEAD');
  const treeSha = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
  return { repositoryRoot, commitSha, treeSha };
}

function generatedFixture(repositoryRoot: string) {
  const roots = ['dist', 'node_modules', 'test-results'];
  for (const root of roots) {
    mkdirSync(path.join(repositoryRoot, 'ops-console', root), { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'ops-console', root, `${root}.txt`), `${root}\n`);
  }
}

function frozenFixture() {
  const fixture = repositoryFixture();
  generatedFixture(fixture.repositoryRoot);
  return buildFrozenOpsCapture({
    canonicalRepositoryRoot: fixture.repositoryRoot,
    canonicalGitSha: fixture.commitSha,
    embeddedRepositoryRoot: fixture.repositoryRoot,
    embeddedGitSha: fixture.commitSha,
    embeddedWorktreeRoot: fixture.repositoryRoot,
    capturedAt,
    runtimeIdentity: {
      currentReleaseName: 'fixture-release',
      services: [
        {
          name: 'edutrack-ops-web.service',
          activeState: 'active',
          subState: 'running',
          fragmentScope: 'system'
        }
      ]
    }
  });
}

function runValidationCli(
  inputs: unknown,
  ledger: unknown,
  extraArguments: string[] = [],
  repositoryRoot?: string
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ops-disposition-cli-'));
  const inputPath = path.join(directory, '2026-08-29-ops-consolidation-inputs.json');
  const ledgerPath = path.join(directory, '2026-08-29-ops-disposition-ledger.json');
  writeFileSync(inputPath, deterministicJson(inputs));
  writeFileSync(ledgerPath, deterministicJson(ledger));
  return spawnSync(process.execPath, [SCRIPT_PATH, ledgerPath, ...extraArguments], {
    cwd: repositoryRoot ?? directory,
    encoding: 'utf8'
  });
}

function gitBlobIdentity(repositoryRoot: string, commitSha: string, filePath: string) {
  const gitBlobSha = git(repositoryRoot, 'rev-parse', `${commitSha}:${filePath}`);
  const bytes = execFileSync('git', ['cat-file', 'blob', `${commitSha}:${filePath}`], {
    cwd: repositoryRoot
  });
  return {
    path: filePath,
    gitBlobSha,
    contentSha256: createHash('sha256').update(bytes).digest('hex')
  };
}

function finalMappingFixture() {
  const fixture = repositoryFixture();
  const embeddedGitSha = fixture.commitSha;
  mkdirSync(path.join(fixture.repositoryRoot, 'canonical'), { recursive: true });
  mkdirSync(path.join(fixture.repositoryRoot, 'docs'), { recursive: true });
  writeFileSync(path.join(fixture.repositoryRoot, 'canonical/alpha.ts'), 'canonical alpha\n');
  writeFileSync(path.join(fixture.repositoryRoot, 'canonical/Alpha.ts'), 'case alias\n');
  writeFileSync(path.join(fixture.repositoryRoot, 'canonical/beta.ts'), 'canonical beta\n');
  writeFileSync(path.join(fixture.repositoryRoot, 'canonical/caf\u00e9.ts'), 'nfc\n');
  writeFileSync(path.join(fixture.repositoryRoot, 'canonical/cafe\u0301.ts'), 'nfd\n');
  symlinkSync('alpha.ts', path.join(fixture.repositoryRoot, 'canonical/link.ts'));
  writeFileSync(
    path.join(fixture.repositoryRoot, 'docs/mapping-evidence.md'),
    'mapping evidence\n'
  );
  writeFileSync(path.join(fixture.repositoryRoot, 'docs/other-evidence.md'), 'other evidence\n');
  git(fixture.repositoryRoot, 'add', '.');
  git(fixture.repositoryRoot, 'commit', '-m', 'canonical mapping targets');
  const targetCommit = git(fixture.repositoryRoot, 'rev-parse', 'HEAD');
  git(
    fixture.repositoryRoot,
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${embeddedGitSha},canonical/submodule`
  );
  git(fixture.repositoryRoot, 'commit', '-m', 'gitlink fixture');
  const headSha = git(fixture.repositoryRoot, 'rev-parse', 'HEAD');
  generatedFixture(fixture.repositoryRoot);
  const captured = buildFrozenOpsCapture({
    canonicalRepositoryRoot: fixture.repositoryRoot,
    canonicalGitSha: headSha,
    embeddedRepositoryRoot: fixture.repositoryRoot,
    embeddedGitSha,
    embeddedWorktreeRoot: fixture.repositoryRoot,
    capturedAt,
    runtimeIdentity: {
      currentReleaseName: 'fixture-release',
      services: [
        {
          name: 'edutrack-ops-web.service',
          activeState: 'active',
          subState: 'running',
          fragmentScope: 'system'
        }
      ]
    }
  });
  const targetPaths = ['canonical/alpha.ts', 'canonical/beta.ts'];
  const finalLedger = structuredClone(captured.ledger);
  finalLedger.state = 'final';
  let targetIndex = 0;
  for (const item of finalLedger.entries) {
    item.targetGitBlobSha ??= null;
    item.targetContentSha256 ??= null;
    item.evidenceIdentities ??= [];
    if (item.sourceKind !== 'git-blob') continue;
    const targetPath = targetPaths[targetIndex];
    targetIndex += 1;
    const target = gitBlobIdentity(fixture.repositoryRoot, headSha, targetPath);
    const evidence = [
      target,
      gitBlobIdentity(fixture.repositoryRoot, headSha, 'docs/mapping-evidence.md')
    ];
    Object.assign(item, {
      targetPath,
      targetGitBlobSha: target.gitBlobSha,
      targetContentSha256: target.contentSha256,
      disposition: 'integrate',
      replacementSha: headSha,
      evidence: evidence.map((identity) => identity.path),
      evidenceIdentities: evidence
    });
  }
  return {
    ...fixture,
    embeddedGitSha,
    targetCommit,
    headSha,
    inputs: captured.inputs,
    ledger: finalLedger
  };
}

describe('Ops disposition ledger', () => {
  it('rejects empty, pathless, unknown and unresolved entries with stable codes', () => {
    expect(() =>
      validateOpsDisposition({ schemaVersion: 1, state: 'construction', capturedAt, entries: [] })
    ).toThrow('OPS_DISPOSITION_EMPTY');

    const pathless = pendingEntry('');
    expect(() =>
      validateOpsDisposition({
        schemaVersion: 1,
        state: 'construction',
        capturedAt,
        entries: [pathless]
      })
    ).toThrow('OPS_DISPOSITION_PATH_INVALID');

    for (const invalidPath of [
      'ops-console//src/App.tsx',
      '/ops-console/src/App.tsx',
      'ops-console\\src\\App.tsx',
      'ops-console/./src/App.tsx',
      'ops-console/../src/App.tsx',
      'ops-console/src/App\u0000.tsx',
      'ops-console/src/cafe\u0301.tsx'
    ]) {
      expect(() =>
        validateOpsDisposition({
          schemaVersion: 1,
          state: 'construction',
          capturedAt,
          entries: [pendingEntry(invalidPath)]
        })
      ).toThrow('OPS_DISPOSITION_PATH_INVALID');
    }

    const unknown = { ...pendingEntry(), disposition: 'keep-both' };
    expect(() =>
      validateOpsDisposition({
        schemaVersion: 1,
        state: 'construction',
        capturedAt,
        entries: [unknown]
      })
    ).toThrow('OPS_DISPOSITION_UNKNOWN');

    expect(() =>
      validateOpsDisposition({
        schemaVersion: 1,
        state: 'construction',
        capturedAt,
        entries: [pendingEntry()]
      })
    ).toThrow('OPS_DISPOSITION_PENDING');
  });

  it('allows pending entries only through the construction API', () => {
    const value = {
      schemaVersion: 1,
      state: 'construction',
      capturedAt,
      entries: [pendingEntry()]
    };

    expect(() => validateOpsDisposition(value, { allowPending: true })).toThrow(
      'OPS_DISPOSITION_PENDING'
    );
    expect(validateOpsDispositionForConstruction(value).entries).toHaveLength(1);
  });

  it('rejects duplicate identities, invalid replacement states and nondeterministic order', () => {
    const first = pendingEntry('ops-console/a.ts');
    const second = pendingEntry('ops-console/b.ts');
    const duplicate = { ...first, sourceSha256: '3'.repeat(64) };

    expect(() =>
      validateOpsDispositionForConstruction({
        schemaVersion: 1,
        state: 'construction',
        capturedAt,
        entries: [first, duplicate]
      })
    ).toThrow('OPS_DISPOSITION_DUPLICATE_SOURCE');
    expect(() =>
      validateOpsDispositionForConstruction({
        schemaVersion: 1,
        state: 'construction',
        capturedAt,
        entries: [second, first]
      })
    ).toThrow('OPS_DISPOSITION_ORDER_INVALID');
    expect(() =>
      validateOpsDispositionForConstruction({
        schemaVersion: 1,
        state: 'construction',
        capturedAt,
        entries: [pendingEntry('ops-console/A.ts'), pendingEntry('ops-console/a.ts')]
      })
    ).toThrow('OPS_DISPOSITION_PATH_ALIAS_COLLISION');

    const unresolved = {
      ...first,
      disposition: 'integrate',
      targetPath: null,
      replacementSha: null
    };
    expect(() =>
      validateOpsDisposition({
        schemaVersion: 1,
        state: 'final',
        capturedAt,
        entries: [unresolved]
      })
    ).toThrow('OPS_DISPOSITION_REPLACEMENT_REQUIRED');

    expect(() =>
      validateOpsDispositionForConstruction({
        schemaVersion: 1,
        state: 'construction',
        capturedAt,
        entries: [{ ...first, unexpectedField: true }]
      })
    ).toThrow('OPS_DISPOSITION_SCHEMA_INVALID');
  });

  it('freezes exact Git blobs at a full commit without depending on a moving ref', () => {
    const fixture = repositoryFixture();
    const before = captureTrackedGitInventory({
      repositoryRoot: fixture.repositoryRoot,
      commitSha: fixture.commitSha
    });

    expect(before.entries).toEqual([
      {
        sourcePath: 'ops-console/src/alpha.txt',
        gitBlobSha: '4a58007052a65fbc2fc3f910f2855f45a4058e74',
        contentSha256: 'b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060'
      },
      {
        sourcePath: 'ops-console/src/beta.txt',
        gitBlobSha: '65b2df87f7df3aeedef04be96703e55ac19c2cfb',
        contentSha256: 'f2c82decdd7181cf98945929a62598db7e6b477e11f6e0eb0ae97020eff151ad'
      }
    ]);

    writeFileSync(path.join(fixture.repositoryRoot, 'ops-console/src/alpha.txt'), 'moved\n');
    git(fixture.repositoryRoot, 'add', '.');
    git(fixture.repositoryRoot, 'commit', '-m', 'move ref');
    const after = captureTrackedGitInventory({
      repositoryRoot: fixture.repositoryRoot,
      commitSha: fixture.commitSha
    });
    expect(after).toEqual(before);
  });

  it('rejects generated-root substitution, root symlinks and forbidden files', () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'ops-generated-root-'));
    const validRoot = path.join(repositoryRoot, 'ops-console/dist');
    mkdirSync(validRoot, { recursive: true });
    writeFileSync(path.join(validRoot, 'asset.js'), 'asset\n');
    writeFileSync(path.join(validRoot, 'startVitestModuleRunner.DB-7oCpn.js'), 'chunk\n');
    expect(captureGeneratedRoot(validRoot, 'ops-console/dist').fileCount).toBe(2);

    expect(() => captureGeneratedRoot(validRoot, 'ops-console/shared')).toThrow(
      'OPS_GENERATED_ROOT_PATH_FORBIDDEN'
    );

    const linkRoot = path.join(repositoryRoot, 'ops-console/test-results');
    symlinkSync(validRoot, linkRoot);
    expect(() => captureGeneratedRoot(linkRoot, 'ops-console/test-results')).toThrow(
      'OPS_GENERATED_ROOT_SYMLINK'
    );

    const escapingLink = path.join(validRoot, 'escape');
    symlinkSync('../../../outside', escapingLink);
    expect(() => captureGeneratedRoot(validRoot, 'ops-console/dist')).toThrow(
      'OPS_GENERATED_ROOT_SYMLINK'
    );

    const dependencyRoot = path.join(repositoryRoot, 'ops-console/node_modules');
    mkdirSync(path.join(dependencyRoot, '.bin'), { recursive: true });
    mkdirSync(path.join(dependencyRoot, 'pkg'), { recursive: true });
    writeFileSync(path.join(dependencyRoot, 'pkg/tool.js'), 'tool\n');
    writeFileSync(path.join(dependencyRoot, 'pkg/other.js'), 'other\n');
    symlinkSync('../pkg/tool.js', path.join(dependencyRoot, '.bin/tool'));
    const firstLinkCapture = captureGeneratedRoot(dependencyRoot, 'ops-console/node_modules');
    expect(firstLinkCapture).toMatchObject({
      symlinkCount: 1,
      fileCount: 2
    });
    unlinkSync(path.join(dependencyRoot, '.bin/tool'));
    symlinkSync('../pkg/other.js', path.join(dependencyRoot, '.bin/tool'));
    const secondLinkCapture = captureGeneratedRoot(dependencyRoot, 'ops-console/node_modules');
    expect(secondLinkCapture.treeSha256).not.toBe(firstLinkCapture.treeSha256);
    writeFileSync(path.join(dependencyRoot, '.env.production'), 'TOKEN=do-not-capture\n');
    expect(() => captureGeneratedRoot(dependencyRoot, 'ops-console/node_modules')).toThrow(
      'OPS_GENERATED_ROOT_FORBIDDEN_FILE'
    );
  });

  it('binds the ledger to the finite frozen universe', () => {
    const { inputs, ledger } = frozenFixture();
    expect(validateOpsInputs(inputs).trackedFiles).toHaveLength(2);
    expect(validateOpsDispositionForConstruction(ledger, inputs).entries).toHaveLength(5);

    const missing = structuredClone(ledger);
    missing.entries.splice(1, 1);
    expect(() => validateOpsDispositionForConstruction(missing, inputs)).toThrow(
      'OPS_DISPOSITION_FROZEN_MISSING'
    );

    const extra = structuredClone(ledger);
    extra.entries.push({ ...pendingEntry('ops-console/z-extra.ts'), sourceGitBlobSha: sha40 });
    expect(() => validateOpsDispositionForConstruction(extra, inputs)).toThrow(
      'OPS_DISPOSITION_FROZEN_UNEXPECTED'
    );

    const altered = structuredClone(ledger);
    altered.entries[0].sourceSha256 = 'f'.repeat(64);
    expect(() => validateOpsDispositionForConstruction(altered, inputs)).toThrow(
      'OPS_DISPOSITION_FROZEN_DIGEST_MISMATCH'
    );

    const collidingInputs = structuredClone(inputs);
    collidingInputs.trackedFiles[0].sourcePath = 'ops-console/dist';
    expect(() => validateOpsInputs(collidingInputs)).toThrow('OPS_INPUTS_SOURCE_COLLISION');
  });

  it('emits deterministic JSON without secret values or absolute host paths', () => {
    const captured = frozenFixture();
    expect(deterministicJson({ b: 1, a: 2 })).toBe(deterministicJson({ a: 2, b: 1 }));
    expect(deterministicJson(captured.ledger)).not.toMatch(/node_modules\/[^{\n]+/);
    expect(() => assertSafeEvidenceJson(captured.inputs)).not.toThrow();
    expect(() => assertSafeEvidenceJson({ leaked: '/home/deploy/private' })).toThrow(
      'OPS_EVIDENCE_ABSOLUTE_PATH'
    );
    expect(() => assertSafeEvidenceJson({ token: 'TOKEN=do-not-capture' })).toThrow(
      'OPS_EVIDENCE_SECRET'
    );
    expect(() => assertSafeEvidenceJson({ password: 'opaque-value' })).toThrow(
      'OPS_EVIDENCE_SECRET'
    );
  });

  it('keeps the default CLI strict and provides no allow-pending flag', () => {
    const { inputs, ledger } = frozenFixture();
    const pending = runValidationCli(inputs, ledger);
    expect(pending.status).toBe(1);
    expect(pending.stdout).toBe('');
    expect(pending.stderr).toBe('OPS_DISPOSITION_PENDING\n');

    const bypass = runValidationCli(inputs, ledger, ['--allow-pending']);
    expect(bypass.status).toBe(1);
    expect(bypass.stdout).toBe('');
    expect(bypass.stderr).toBe('OPS_DISPOSITION_ARGUMENTS_INVALID\n');
  });

  it(
    'rejects ungrounded final mappings through both the API and real CLI',
    { timeout: 20_000 },
    () => {
      const fixture = finalMappingFixture();
      const orphanTree = git(fixture.repositoryRoot, 'rev-parse', `${fixture.headSha}^{tree}`);
      const unreachableSha = execFileSync(
        'git',
        ['commit-tree', orphanTree, '-m', 'unreachable fixture'],
        { cwd: fixture.repositoryRoot, encoding: 'utf8' }
      ).trim();
      git(
        fixture.repositoryRoot,
        'tag',
        '-a',
        'replacement-tag',
        fixture.headSha,
        '-m',
        'replacement tag fixture'
      );
      const tagObjectSha = git(fixture.repositoryRoot, 'rev-parse', 'replacement-tag^{tag}');
      const firstTracked = fixture.ledger.entries.find(
        (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
      );
      if (!firstTracked) throw new Error('missing first tracked fixture');
      const alphaTarget = gitBlobIdentity(
        fixture.repositoryRoot,
        fixture.headSha,
        'canonical/alpha.ts'
      );
      const alphaEvidence = [
        alphaTarget,
        gitBlobIdentity(fixture.repositoryRoot, fixture.headSha, 'docs/mapping-evidence.md')
      ];
      const setTarget = (
        ledger: typeof fixture.ledger,
        index: number,
        targetPath: string,
        targetGitBlobSha: string,
        targetContentSha256 = '9'.repeat(64)
      ) => {
        const tracked = ledger.entries.filter(
          (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
        );
        Object.assign(tracked[index], {
          targetPath,
          targetGitBlobSha,
          targetContentSha256,
          evidence: [targetPath, 'docs/mapping-evidence.md'],
          evidenceIdentities: [
            { path: targetPath, gitBlobSha: targetGitBlobSha, contentSha256: targetContentSha256 },
            alphaEvidence[1]
          ]
        });
      };
      const cases = [
        {
          name: 'absent replacement',
          code: 'OPS_DISPOSITION_REPLACEMENT_ABSENT',
          mutate(ledger: typeof fixture.ledger) {
            ledger.entries.find(
              (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
            ).replacementSha = 'f'.repeat(40);
          }
        },
        {
          name: 'unreachable replacement',
          code: 'OPS_DISPOSITION_REPLACEMENT_UNREACHABLE',
          mutate(ledger: typeof fixture.ledger) {
            ledger.entries.find(
              (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
            ).replacementSha = unreachableSha;
          }
        },
        {
          name: 'replacement is not a commit object',
          code: 'OPS_DISPOSITION_REPLACEMENT_NOT_COMMIT',
          mutate(ledger: typeof fixture.ledger) {
            ledger.entries.find(
              (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
            ).replacementSha = tagObjectSha;
          }
        },
        {
          name: 'absent target',
          code: 'OPS_DISPOSITION_TARGET_ABSENT',
          mutate(ledger: typeof fixture.ledger) {
            setTarget(ledger, 0, 'canonical/missing.ts', '8'.repeat(40));
          }
        },
        {
          name: 'tree target',
          code: 'OPS_DISPOSITION_TARGET_TYPE_INVALID',
          mutate(ledger: typeof fixture.ledger) {
            setTarget(
              ledger,
              0,
              'canonical',
              git(fixture.repositoryRoot, 'rev-parse', `${fixture.headSha}:canonical`)
            );
          }
        },
        {
          name: 'symlink target',
          code: 'OPS_DISPOSITION_TARGET_TYPE_INVALID',
          mutate(ledger: typeof fixture.ledger) {
            const identity = gitBlobIdentity(
              fixture.repositoryRoot,
              fixture.headSha,
              'canonical/link.ts'
            );
            setTarget(ledger, 0, identity.path, identity.gitBlobSha, identity.contentSha256);
          }
        },
        {
          name: 'submodule target',
          code: 'OPS_DISPOSITION_TARGET_TYPE_INVALID',
          mutate(ledger: typeof fixture.ledger) {
            setTarget(
              ledger,
              0,
              'canonical/submodule',
              git(fixture.repositoryRoot, 'rev-parse', `${fixture.headSha}:canonical/submodule`)
            );
          }
        },
        {
          name: 'target object identity tamper',
          code: 'OPS_DISPOSITION_TARGET_IDENTITY_MISMATCH',
          mutate(ledger: typeof fixture.ledger) {
            ledger.entries.find(
              (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
            ).targetGitBlobSha = 'f'.repeat(40);
          }
        },
        {
          name: 'target digest tamper',
          code: 'OPS_DISPOSITION_TARGET_DIGEST_MISMATCH',
          mutate(ledger: typeof fixture.ledger) {
            ledger.entries.find(
              (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
            ).targetContentSha256 = 'f'.repeat(64);
          }
        },
        {
          name: 'absent evidence',
          code: 'OPS_DISPOSITION_EVIDENCE_ABSENT',
          mutate(ledger: typeof fixture.ledger) {
            const item = ledger.entries.find(
              (entry: { sourceKind: string }) => entry.sourceKind === 'git-blob'
            );
            item.evidence = [item.targetPath, 'docs/missing.md'];
            item.evidenceIdentities = [
              alphaTarget,
              { path: 'docs/missing.md', gitBlobSha: '8'.repeat(40), contentSha256: '9'.repeat(64) }
            ];
          }
        },
        {
          name: 'evidence digest tamper',
          code: 'OPS_DISPOSITION_EVIDENCE_DIGEST_MISMATCH',
          mutate(ledger: typeof fixture.ledger) {
            ledger.entries.find(
              (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
            ).evidenceIdentities[1].contentSha256 = 'f'.repeat(64);
          }
        },
        {
          name: 'case target alias',
          code: 'OPS_DISPOSITION_TARGET_ALIAS_COLLISION',
          mutate(ledger: typeof fixture.ledger) {
            const identity = gitBlobIdentity(
              fixture.repositoryRoot,
              fixture.headSha,
              'canonical/Alpha.ts'
            );
            setTarget(ledger, 1, identity.path, identity.gitBlobSha, identity.contentSha256);
          }
        },
        {
          name: 'Unicode target alias',
          code: 'OPS_DISPOSITION_TARGET_PATH_INVALID',
          mutate(ledger: typeof fixture.ledger) {
            const targetPath = 'canonical/cafe\u0301.ts';
            const gitBlobSha = git(
              fixture.repositoryRoot,
              'rev-parse',
              `${fixture.headSha}:${targetPath}`
            );
            setTarget(ledger, 1, targetPath, gitBlobSha);
          }
        },
        {
          name: 'arbitrary all-to-one substitution',
          code: 'OPS_DISPOSITION_MANY_TO_ONE_CONFLICT',
          mutate(ledger: typeof fixture.ledger) {
            const tracked = ledger.entries.filter(
              (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
            );
            tracked[1].targetPath = tracked[0].targetPath;
            tracked[1].targetGitBlobSha = tracked[0].targetGitBlobSha;
            tracked[1].targetContentSha256 = tracked[0].targetContentSha256;
            const otherEvidence = gitBlobIdentity(
              fixture.repositoryRoot,
              fixture.headSha,
              'docs/other-evidence.md'
            );
            tracked[1].evidence = [tracked[0].targetPath, otherEvidence.path];
            tracked[1].evidenceIdentities = [alphaTarget, otherEvidence];
          }
        }
      ];

      for (const testCase of cases) {
        const ledger = structuredClone(fixture.ledger);
        testCase.mutate(ledger);
        expect(
          () =>
            validateFinalOpsDisposition(ledger, fixture.inputs, {
              repositoryRoot: fixture.repositoryRoot,
              headSha: fixture.headSha
            }),
          testCase.name
        ).toThrow(testCase.code);
        const cli = runValidationCli(fixture.inputs, ledger, [], fixture.repositoryRoot);
        expect(cli.status, testCase.name).toBe(1);
        expect(cli.stdout, testCase.name).toBe('');
        expect(cli.stderr, testCase.name).toBe(`${testCase.code}\n`);
      }
    }
  );

  it('allows an intentional exact many-to-one mapping proven by Git', () => {
    const fixture = finalMappingFixture();
    const ledger = structuredClone(fixture.ledger);
    const tracked = ledger.entries.filter(
      (item: { sourceKind: string }) => item.sourceKind === 'git-blob'
    );
    Object.assign(tracked[1], {
      targetPath: tracked[0].targetPath,
      targetGitBlobSha: tracked[0].targetGitBlobSha,
      targetContentSha256: tracked[0].targetContentSha256,
      replacementSha: tracked[0].replacementSha,
      evidence: structuredClone(tracked[0].evidence),
      evidenceIdentities: structuredClone(tracked[0].evidenceIdentities)
    });

    expect(() => validateOpsDisposition(ledger)).toThrow('OPS_DISPOSITION_FINAL_PROOF_REQUIRED');
    expect(
      validateFinalOpsDisposition(ledger, fixture.inputs, {
        repositoryRoot: fixture.repositoryRoot,
        headSha: fixture.headSha
      }).entries
    ).toHaveLength(5);
    const cli = runValidationCli(fixture.inputs, ledger, [], fixture.repositoryRoot);
    expect(cli.status).toBe(0);
    expect(cli.stdout).toBe('OPS_DISPOSITION_PASS entries=5\n');
    expect(cli.stderr).toBe('');
  });

  it('pins the reviewed inventory to 128 Git blobs and exactly three generated roots', () => {
    const inputs = JSON.parse(readFileSync(REVIEWED_INPUT_PATH, 'utf8'));
    const ledger = JSON.parse(readFileSync(REVIEWED_LEDGER_PATH, 'utf8'));

    expect(validateOpsInputs(inputs)).toMatchObject({
      canonical: {
        gitSha: '4313023f483b48d81cab45174db38fc893900444',
        treeSha: '8dd654a311f513932c8368a38bddbed1f73d517d'
      },
      embedded: {
        gitSha: '5dff838be4f4b60232cf4a8c34b6292c35c489dc',
        treeSha: '0de2d5f7c0b7c7a87c4e06ec978e72e91829514a'
      },
      trackedFileCount: 128,
      trackedInventorySha256: '704ba270ca8e4109a352bd37aa033f56e7520199a0a4fdac9fff2f1de2e86c84',
      generatedRootCount: 3,
      generatedInventorySha256: '4a4efaa55e3abae3ab3cb5fc72c8785ad5c3a7777b4e6a01a51a20d035f19736',
      frozenUniverseSha256: '52599cccdf80660614e115c87072031869c6cfd0ab0a9ac8276f9c03609a8776'
    });
    expect(inputs.runtimeIdentity).toEqual({
      currentReleaseName: 'beszel-disabled-20260824-1458',
      services: [
        {
          activeState: 'active',
          fragmentScope: 'system',
          name: 'edutrack-ops-collector.service',
          subState: 'running'
        },
        {
          activeState: 'active',
          fragmentScope: 'system',
          name: 'edutrack-ops-web.service',
          subState: 'running'
        }
      ]
    });
    expect(inputs.generatedRoots.map((item: { sourcePath: string }) => item.sourcePath)).toEqual([
      'ops-console/dist',
      'ops-console/node_modules',
      'ops-console/test-results'
    ]);
    expect(inputs.generatedRoots[1].symlinkCount).toBe(22);
    expect(ledger).toMatchObject({ schemaVersion: 1, state: 'construction' });
    expect(validateOpsDispositionForConstruction(ledger, inputs).entries).toHaveLength(131);
  });

  it('records an undeployed PostgreSQL migration plane without fabricating an empty capture', () => {
    const inputs = JSON.parse(readFileSync(REVIEWED_INPUT_PATH, 'utf8'));

    expect(validateOpsInputs(inputs).migrationBaseline).toEqual({
      evidence: {
        credentialResolver: 'not_deployed',
        legacyRuntime: 'sqlite_web_collector_only',
        postgresApiPlane: 'not_deployed'
      },
      requiredBeforeCutover: [
        'deploy a credential-resolved canonical Ops PostgreSQL endpoint',
        'capture sorted migration IDs through that resolver',
        'persist only the approved ID list, count, and SHA-256 digest',
        'reject cutover if capture is unavailable or migration history does not validate'
      ],
      state: 'not_deployed'
    });

    expect(() =>
      validateOpsInputs({
        ...inputs,
        migrationBaseline: {
          ...inputs.migrationBaseline,
          ids: [],
          count: 0,
          sha256: '0'.repeat(64)
        }
      })
    ).toThrow('OPS_INPUTS_SCHEMA_INVALID');
  });
});
