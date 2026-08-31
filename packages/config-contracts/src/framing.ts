export const FRAME_HEADER_BYTES = 4;
export const MAX_FRAME_BYTES = 1_048_576;
export const MAX_BUFFER_BYTES = MAX_FRAME_BYTES * 4;

function assertFrameSize(size: number): void {
  if (!Number.isInteger(size) || size < 0 || size > MAX_FRAME_BYTES) {
    throw new Error('Frame exceeds the maximum supported size');
  }
}

function decodeJsonFrame(payload: Buffer): unknown {
  return JSON.parse(payload.toString('utf8'));
}

export function encodeFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  assertFrameSize(payload.length);
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    if (this.buffer.length + chunk.length > MAX_BUFFER_BYTES) {
      throw new Error('Frame buffer exceeds the maximum supported size');
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    const decoded: unknown[] = [];

    while (this.buffer.length >= FRAME_HEADER_BYTES) {
      const frameLength = this.buffer.readUInt32BE(0);
      assertFrameSize(frameLength);
      if (this.buffer.length < FRAME_HEADER_BYTES + frameLength) {
        break;
      }

      const payloadStart = FRAME_HEADER_BYTES;
      const payloadEnd = FRAME_HEADER_BYTES + frameLength;
      const payload = this.buffer.subarray(payloadStart, payloadEnd);
      decoded.push(decodeJsonFrame(payload));
      this.buffer = this.buffer.subarray(payloadEnd);
    }

    return decoded;
  }

  finish(): unknown[] {
    if (this.buffer.length !== 0) {
      throw new Error('Frame stream ended with trailing bytes');
    }
    return [];
  }
}

export function decodeFrames(buffer: Buffer): unknown[] {
  const decoder = new FrameDecoder();
  const decoded = decoder.push(buffer);
  decoder.finish();
  return decoded;
}
