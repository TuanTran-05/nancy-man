import { createHash, timingSafeEqual } from 'node:crypto';

function normalizeCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function formatCode(hex: string): string {
  const code = hex.slice(0, 16).toUpperCase();
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeCode(code), 'utf8').digest('hex');
}

export function issueRecoveryCodes(randomValue: () => string): {
  plainCodes: string[];
  codeHashes: string[];
} {
  const plainCodes = Array.from({ length: 10 }, (_, index) => {
    const seed = `${randomValue()}:${index}`;
    return formatCode(createHash('sha256').update(seed, 'utf8').digest('hex'));
  });

  return { plainCodes, codeHashes: plainCodes.map(hashRecoveryCode) };
}

export async function consumeRecoveryCode(
  presentedCode: string,
  codeHashes: readonly string[],
  repository: { consumeIfUnused: (codeHash: string) => Promise<boolean> }
): Promise<boolean> {
  const presentedHash = Buffer.from(hashRecoveryCode(presentedCode), 'utf8');
  const matchingHash = codeHashes.find((candidate) => {
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    return (
      candidateBuffer.length === presentedHash.length &&
      timingSafeEqual(candidateBuffer, presentedHash)
    );
  });

  return matchingHash ? repository.consumeIfUnused(matchingHash) : false;
}
