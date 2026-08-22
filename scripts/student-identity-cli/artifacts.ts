import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson, sha256 } from '../student-profile-normalization/canonicalJson.js';
import type { StudentIdentityCliRuntime } from './runtime.js';

export async function readJsonArtifact<T>(
  filePath: string,
  runtime: Pick<StudentIdentityCliRuntime, 'readText'>
): Promise<T> {
  return JSON.parse(await runtime.readText(filePath)) as T;
}

/**
 * The same canonical bytes and digest as `writeJsonArtifactAtomic`, written
 * through the runtime rather than straight to disk.
 *
 * Commands use this one so the destination is whatever the runtime says it is:
 * a create-only file in production, an assertion in a test. A command that
 * reaches past its runtime to `fs` cannot be exercised without leaving files
 * behind, which is how artifact writing went untested in the first place.
 */
export async function writeJsonArtifactThroughRuntime(
  outputPath: string,
  data: unknown,
  runtime: Pick<StudentIdentityCliRuntime, 'writeTextAtomic'>
): Promise<{ digest: string }> {
  const contents = canonicalJson(data);
  await runtime.writeTextAtomic(outputPath, contents);
  return { digest: sha256(contents) };
}

async function syncParentDirectory(directory: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(code ?? '')) throw error;
  } finally {
    await handle?.close();
  }
}

export async function writeJsonArtifactAtomic(
  outputPath: string,
  data: unknown,
  options?: { idempotent?: boolean }
): Promise<{ digest: string; outcome: 'created' | 'unchanged' }> {
  const contents = canonicalJson(data);
  const digest = sha256(contents);

  if (options?.idempotent) {
    try {
      if (await fs.readFile(outputPath, 'utf8') === contents) {
        return { digest, outcome: 'unchanged' };
      }
      throw new Error('STUDENT_IDENTITY_ARTIFACT_CONFLICT');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let ownsTemporaryPath = false;
  let primaryError: unknown;
  try {
    const handle = await fs.open(temporaryPath, 'wx', 0o600);
    ownsTemporaryPath = true;
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.link(temporaryPath, outputPath);
    await syncParentDirectory(dirname(outputPath));
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (ownsTemporaryPath) {
      await fs.unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT' && primaryError === undefined) throw error;
      });
    }
  }

  return { digest, outcome: 'created' };
}
