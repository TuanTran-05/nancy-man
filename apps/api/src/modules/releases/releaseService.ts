import { createHash } from 'node:crypto';

const maximumSourceMaps = 100;
const maximumSourceMapBytes = 10 * 1024 * 1024;

export async function registerRelease(
  input: {
    serviceName: string;
    releaseSha: string;
    buildId: string;
    deployedAt: string;
    sourceMaps: Array<{ generatedFile: string; content: string; sha256: string }>;
  },
  dependencies: {
    objectStore: {
      putIfAbsent: (
        objectKey: string,
        content: string,
        sha256: string
      ) => Promise<'created' | 'identical' | 'conflict'>;
    };
    repository: {
      upsertRelease: (input: {
        serviceName: string;
        releaseSha: string;
        buildId: string;
        deployedAt: Date;
      }) => Promise<{ id: string }>;
      recordSourceMap: (input: {
        releaseId: string;
        objectKey: string;
        sha256: string;
        generatedFile: string;
      }) => Promise<void>;
    };
  }
): Promise<{ releaseId: string }> {
  if (!/^[a-f0-9]{40}$/i.test(input.releaseSha)) {
    throw new Error('Release SHA must be a full 40-character commit digest');
  }
  const deployedAt = new Date(input.deployedAt);
  if (!Number.isFinite(deployedAt.getTime())) {
    throw new Error('Release deploy timestamp is invalid');
  }
  if (!input.serviceName || !input.buildId || input.sourceMaps.length > maximumSourceMaps) {
    throw new Error('Release manifest is invalid');
  }

  for (const sourceMap of input.sourceMaps) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,512}$/.test(sourceMap.generatedFile) ||
      Buffer.byteLength(sourceMap.content, 'utf8') > maximumSourceMapBytes
    ) {
      throw new Error('Source map manifest entry is invalid');
    }
    const checksum = createHash('sha256').update(sourceMap.content, 'utf8').digest('hex');
    if (checksum !== sourceMap.sha256) {
      throw new Error('Source map checksum mismatch');
    }
  }

  const release = await dependencies.repository.upsertRelease({
    serviceName: input.serviceName,
    releaseSha: input.releaseSha.toLowerCase(),
    buildId: input.buildId,
    deployedAt
  });
  for (const sourceMap of input.sourceMaps) {
    const objectKey = `source-maps/${input.serviceName}/${input.releaseSha.toLowerCase()}/${sourceMap.sha256}.map`;
    const stored = await dependencies.objectStore.putIfAbsent(
      objectKey,
      sourceMap.content,
      sourceMap.sha256
    );
    if (stored === 'conflict') {
      throw new Error('A different source map already occupies this object key');
    }
    await dependencies.repository.recordSourceMap({
      releaseId: release.id,
      objectKey,
      sha256: sourceMap.sha256,
      generatedFile: sourceMap.generatedFile
    });
  }
  return { releaseId: release.id };
}
