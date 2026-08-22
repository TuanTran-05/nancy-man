import { createHash, randomBytes } from 'node:crypto';
export function issueEnrollmentToken(random: (size: number) => Buffer = randomBytes): {
  plainToken: string;
  tokenHash: string;
} {
  const plainToken = random(32).toString('base64url');
  return { plainToken, tokenHash: createHash('sha256').update(plainToken, 'utf8').digest('hex') };
}
