#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import process from 'node:process';

const MANIFEST_NAME = '.release-manifest.json';
const MARKER_NAME = '.release-source.json';
const SELF_EXCLUDED = [MANIFEST_NAME, MARKER_NAME];

function fail(code) {
  throw new Error(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function forbiddenPath(path) {
  const segments = path.split('/');
  const name = basename(path).toLowerCase();
  return (
    segments.includes('shared') ||
    segments.includes('node_modules') ||
    segments.includes('logs') ||
    segments.includes('backups') ||
    segments.includes('credential') ||
    segments.includes('credentials') ||
    segments.includes('secret') ||
    segments.includes('secrets') ||
    name === '.env' ||
    name.startsWith('.env.') ||
    /^(?:\.?)(?:credential|credentials|secret|secrets)(?:[._-]|$)|private[._-]?key|\.pem$|\.key$|\.p12$|\.sqlite(?:[.-]|$)|\.db(?:[.-]|$)|\.dump$|\.sql\.(?:gz|zip|zst)$/iu.test(
      name
    )
  );
}

async function entriesFor(root) {
  const rootResolved = await realpath(root).catch(() => fail('RELEASE_MANIFEST_ROOT_INVALID'));
  const entries = [];

  async function visit(directory, relativeDirectory = '') {
    const names = await readdir(directory);
    for (const name of names.sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right))
    )) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (SELF_EXCLUDED.includes(relativePath)) continue;
      if (
        relativePath.includes('..') ||
        relativePath.includes('\\') ||
        forbiddenPath(relativePath)
      ) {
        fail('RELEASE_MANIFEST_PATH_FORBIDDEN');
      }
      const absolutePath = resolve(directory, name);
      if (!absolutePath.startsWith(`${rootResolved}${sep}`)) fail('RELEASE_MANIFEST_ESCAPE');
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) fail('RELEASE_MANIFEST_SYMLINK');
      if (stat.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!stat.isFile()) fail('RELEASE_MANIFEST_TYPE_INVALID');
      if (stat.nlink !== 1) fail('RELEASE_MANIFEST_HARDLINK');
      const bytes = await readFile(absolutePath);
      entries.push({ path: relativePath, sha256: sha256(bytes), size: bytes.length });
    }
  }

  await visit(rootResolved);
  return entries;
}

async function buildManifest(root) {
  return {
    schemaVersion: 1,
    selfExcluded: SELF_EXCLUDED,
    entries: await entriesFor(root)
  };
}

function manifestDigest(manifest) {
  return sha256(canonicalJson(manifest));
}

async function generate(root) {
  const manifest = await buildManifest(root);
  await writeFile(resolve(root, MANIFEST_NAME), canonicalJson(manifest), {
    encoding: 'utf8',
    mode: 0o644
  });
  process.stdout.write(`RELEASE_MANIFEST_GENERATED digest=${manifestDigest(manifest)}\n`);
}

async function verify(root) {
  const serialized = await readFile(resolve(root, MANIFEST_NAME), 'utf8').catch(() =>
    fail('RELEASE_MANIFEST_ABSENT')
  );
  let expected;
  try {
    expected = JSON.parse(serialized);
  } catch {
    fail('RELEASE_MANIFEST_JSON_INVALID');
  }
  if (
    expected?.schemaVersion !== 1 ||
    JSON.stringify(expected.selfExcluded) !== JSON.stringify(SELF_EXCLUDED) ||
    !Array.isArray(expected.entries)
  ) {
    fail('RELEASE_MANIFEST_STRUCTURE_INVALID');
  }
  const actual = await buildManifest(root);
  if (canonicalJson(expected) !== canonicalJson(actual)) fail('RELEASE_MANIFEST_DIGEST_MISMATCH');
  process.stdout.write(`RELEASE_MANIFEST_PASS digest=${manifestDigest(actual)}\n`);
}

const [command, root] = process.argv.slice(2);
if (!root || !['generate', 'verify'].includes(command)) {
  process.stderr.write('RELEASE_MANIFEST_USAGE\n');
  process.exitCode = 64;
} else {
  try {
    if (command === 'generate') await generate(root);
    else await verify(root);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'RELEASE_MANIFEST_FAILED'}\n`);
    process.exitCode = 1;
  }
}
