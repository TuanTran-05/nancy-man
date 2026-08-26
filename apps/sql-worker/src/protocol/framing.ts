const maxFrameBytes = 1_048_576;
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > maxFrameBytes) throw new Error('WORKER_FRAME_TOO_LARGE');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const values: unknown[] = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size > maxFrameBytes) throw new Error('WORKER_FRAME_TOO_LARGE');
      if (this.buffer.length < size + 4) break;
      const body = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      try {
        values.push(JSON.parse(body.toString('utf8')));
      } catch {
        throw new Error('WORKER_FRAME_INVALID_JSON');
      }
    }
    return values;
  }
}
