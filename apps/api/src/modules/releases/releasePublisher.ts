import { type NonceStore, verifyServerIngestRequest } from '../ingest/hmac.js';

const maximumReleasePayloadBytes = 25 * 1024 * 1024;

type ReleaseManifest = {
  serviceName: string;
  releaseSha: string;
  buildId: string;
  deployedAt: string;
  sourceMaps: Array<{ generatedFile: string; content: string; sha256: string }>;
};

type ReleasePublisher = {
  serviceName: string;
  secretReference: string;
  status: 'active' | 'disabled' | 'rotated';
};

type ReleaseRequest = {
  keyId?: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
  rawBody: string;
};

type ReleaseResult =
  | { status: 201; accepted: true; releaseId: string }
  | { status: 400 | 401 | 403 | 413; accepted: false; code: string };

function isManifest(input: unknown): input is ReleaseManifest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const manifest = input as Record<string, unknown>;
  return (
    typeof manifest.serviceName === 'string' &&
    typeof manifest.releaseSha === 'string' &&
    typeof manifest.buildId === 'string' &&
    typeof manifest.deployedAt === 'string' &&
    Array.isArray(manifest.sourceMaps) &&
    manifest.sourceMaps.every(
      (sourceMap) =>
        typeof sourceMap === 'object' &&
        sourceMap !== null &&
        !Array.isArray(sourceMap) &&
        typeof (sourceMap as Record<string, unknown>).generatedFile === 'string' &&
        typeof (sourceMap as Record<string, unknown>).content === 'string' &&
        typeof (sourceMap as Record<string, unknown>).sha256 === 'string'
    )
  );
}

function parseManifest(rawBody: string): ReleaseManifest | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createReleasePublisherService(input: {
  publishers: { findPublisher: (keyId: string) => Promise<ReleasePublisher | null> };
  resolveSecret: (reference: string) => Promise<string | null>;
  nonceStore: NonceStore;
  registerRelease: (manifest: ReleaseManifest) => Promise<{ releaseId: string }>;
  now?: () => Date;
}): { register: (request: ReleaseRequest) => Promise<ReleaseResult> } {
  const now = input.now ?? (() => new Date());

  return {
    register: async (request) => {
      if (Buffer.byteLength(request.rawBody, 'utf8') > maximumReleasePayloadBytes) {
        return { status: 413, accepted: false, code: 'PAYLOAD_TOO_LARGE' };
      }
      if (!request.keyId || !request.signature || !request.timestamp || !request.nonce) {
        return { status: 401, accepted: false, code: 'MISSING_AUTHENTICATION' };
      }

      const publisher = await input.publishers.findPublisher(request.keyId);
      if (!publisher || publisher.status !== 'active') {
        return { status: 401, accepted: false, code: 'INVALID_PUBLISHER' };
      }
      const secret = await input.resolveSecret(publisher.secretReference);
      if (!secret) return { status: 401, accepted: false, code: 'INVALID_PUBLISHER' };

      const verification = await verifyServerIngestRequest({
        secret,
        signature: request.signature,
        nonceStore: input.nonceStore,
        now: now(),
        method: 'POST',
        path: '/api/v1/releases',
        timestamp: request.timestamp,
        nonce: request.nonce,
        rawBody: request.rawBody
      });
      if (!verification.ok) {
        return { status: 401, accepted: false, code: verification.code };
      }

      const manifest = parseManifest(request.rawBody);
      if (!manifest) return { status: 400, accepted: false, code: 'INVALID_RELEASE_MANIFEST' };
      if (manifest.serviceName !== publisher.serviceName) {
        return { status: 403, accepted: false, code: 'SERVICE_NOT_ALLOWED' };
      }

      try {
        const registered = await input.registerRelease(manifest);
        return { status: 201, accepted: true, releaseId: registered.releaseId };
      } catch {
        return { status: 400, accepted: false, code: 'INVALID_RELEASE_MANIFEST' };
      }
    }
  };
}
