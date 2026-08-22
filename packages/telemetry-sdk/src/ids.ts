import { randomBytes as nodeRandomBytes } from 'node:crypto';

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTimestamp = -1;
let lastRandom: Buffer<ArrayBufferLike> = Buffer.alloc(10);

function encodeTime(timestamp: number): string {
  let value = BigInt(timestamp);
  let encoded = '';

  for (let position = 0; position < 10; position += 1) {
    encoded = alphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }

  return encoded;
}

function encodeRandom(random: Buffer<ArrayBufferLike>): string {
  let value = BigInt(`0x${random.toString('hex')}`);
  let encoded = '';

  for (let position = 0; position < 16; position += 1) {
    encoded = alphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }

  return encoded;
}

function incrementRandom(random: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
  const next = Buffer.from(random);
  for (let position = next.length - 1; position >= 0; position -= 1) {
    const value = (next[position] ?? 0) + 1;
    next[position] = value & 0xff;
    if (value <= 0xff) {
      return next;
    }
  }

  throw new Error('ULID randomness exhausted for one millisecond');
}

function createUlid(
  timestamp = Date.now(),
  randomBytes: (size: number) => Buffer<ArrayBufferLike> = nodeRandomBytes
): string {
  const normalizedTimestamp = Math.max(timestamp, lastTimestamp);
  if (normalizedTimestamp === lastTimestamp) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTimestamp = normalizedTimestamp;
    lastRandom = randomBytes(10);
  }

  return `${encodeTime(normalizedTimestamp)}${encodeRandom(lastRandom)}`;
}

export function createEventId(
  timestamp?: number,
  randomBytes?: (size: number) => Buffer<ArrayBufferLike>
): `EVT_${string}` {
  return `EVT_${createUlid(timestamp, randomBytes)}`;
}

export function createRequestId(
  timestamp?: number,
  randomBytes?: (size: number) => Buffer<ArrayBufferLike>
): `REQ_${string}` {
  return `REQ_${createUlid(timestamp, randomBytes)}`;
}
