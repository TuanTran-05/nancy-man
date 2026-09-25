import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCRAM_ITERATIONS = 4096;
const SALT_LENGTH = 16;

export function deriveScramVerifier(password, salt) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('password must be a non-empty string');
  }
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_LENGTH) {
    throw new TypeError(`salt must be ${SALT_LENGTH} bytes`);
  }

  const saltedPassword = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();

  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

async function readPasswordFromStdin() {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > 16_384) throw new RangeError('password input is too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  try {
    if (process.argv.length !== 2) throw new TypeError('unexpected command-line arguments');
    const password = await readPasswordFromStdin();
    const verifier = deriveScramVerifier(password, randomBytes(SALT_LENGTH));
    process.stdout.write(`${verifier}\n`);
  } catch {
    process.stderr.write('derive-scram-verifier: expected a valid password on stdin\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
