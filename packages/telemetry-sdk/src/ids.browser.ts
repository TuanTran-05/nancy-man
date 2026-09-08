const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTimestamp = -1;
let lastRandom: Uint8Array<ArrayBufferLike> = new Uint8Array(10);

function encodeTime(timestamp: number): string {
  let value = BigInt(timestamp);
  let encoded = '';
  for (let position = 0; position < 10; position += 1) {
    encoded = alphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

function encodeRandom(random: Uint8Array): string {
  let value = 0n;
  for (const byte of random) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  for (let position = 0; position < 16; position += 1) {
    encoded = alphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

function incrementRandom(random: Uint8Array): Uint8Array {
  const next = new Uint8Array(random);
  for (let position = next.length - 1; position >= 0; position -= 1) {
    const value = (next[position] ?? 0) + 1;
    next[position] = value & 0xff;
    if (value <= 0xff) return next;
  }
  throw new Error('ULID randomness exhausted for one millisecond');
}

function browserRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function createBrowserEventId(
  timestamp = Date.now(),
  randomBytes: (size: number) => Uint8Array = browserRandomBytes
): `EVT_${string}` {
  const normalizedTimestamp = Math.max(timestamp, lastTimestamp);
  if (normalizedTimestamp === lastTimestamp) lastRandom = incrementRandom(lastRandom);
  else {
    lastTimestamp = normalizedTimestamp;
    lastRandom = randomBytes(10);
  }
  return `EVT_${encodeTime(normalizedTimestamp)}${encodeRandom(lastRandom)}`;
}
