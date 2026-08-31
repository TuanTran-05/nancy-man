import { describe, expect, it } from 'vitest';

import { FrameDecoder, MAX_FRAME_BYTES, decodeFrames, encodeFrame } from './framing.js';

const request = {
  version: 1,
  requestId: 'REQ_20260831_001',
  issuedAt: '2026-08-31T13:10:00.000Z',
  expiresAt: '2026-08-31T13:10:30.000Z',
  actor: {
    userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
    sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f7',
    role: 'ops_owner',
    ipHash: `sha256:${'1'.repeat(64)}`,
    userAgentHash: `sha256:${'2'.repeat(64)}`
  },
  operation: 'inventory.read',
  body: {
    includeValues: true,
    limit: 25
  },
  hmacKeyId: 'config-agent-2026-08-31',
  signature: `sha256:${'c'.repeat(64)}`
} as const;

describe('framing', () => {
  it('round-trips concatenated frames and supports streaming decode', () => {
    expect(decodeFrames(Buffer.concat([encodeFrame(request), encodeFrame(request)]))).toEqual([
      request,
      request
    ]);

    const encoded = encodeFrame(request);
    const decoder = new FrameDecoder();
    expect(decoder.push(encoded.subarray(0, 2))).toEqual([]);
    expect(decoder.push(encoded.subarray(2))).toEqual([request]);
    expect(decoder.finish()).toEqual([]);
  });

  it('rejects oversized frames', () => {
    const payload = Buffer.alloc(MAX_FRAME_BYTES + 1, 'x');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);

    expect(() => decodeFrames(Buffer.concat([header, payload]))).toThrow();
  });

  it('rejects truncated headers and declared-length mismatches', () => {
    expect(() => decodeFrames(Buffer.from([0x00, 0x00, 0x00]))).toThrow();

    const encoded = encodeFrame(request);
    expect(() => decodeFrames(encoded.subarray(0, encoded.length - 1))).toThrow();
  });
});
