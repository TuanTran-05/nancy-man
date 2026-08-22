import { describe, expect, it } from 'vitest';
import { encodeFrame, FrameDecoder } from './framing.js';
describe('worker framing', () => {
  it('decodes partial and consecutive frames while rejecting unsafe input', () => {
    const first = encodeFrame({ id: 1 });
    const second = encodeFrame({ id: 2 });
    const decoder = new FrameDecoder();
    expect(decoder.push(first.subarray(0, 3))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([
      { id: 1 },
      { id: 2 }
    ]);
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(1_048_577);
    expect(() => new FrameDecoder().push(oversized)).toThrow('WORKER_FRAME_TOO_LARGE');
  });
});
