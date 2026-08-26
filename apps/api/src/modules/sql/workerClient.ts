import { createHmac, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type {
  WorkerCommand,
  WorkerResponse
} from '../../../../../packages/contracts/src/workerProtocol.js';
function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
function sign(command: Omit<WorkerCommand, 'signature'>, secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(command), 'utf8').digest('hex');
}
export class SqlWorkerClient {
  constructor(private readonly input: { socketPath: string; secret: string }) {}
  async command(
    input: Omit<WorkerCommand, 'protocolVersion' | 'commandId' | 'issuedAt' | 'nonce' | 'signature'>
  ): Promise<WorkerResponse> {
    const unsigned = {
      ...input,
      protocolVersion: 1 as const,
      commandId: randomUUID(),
      issuedAt: new Date().toISOString(),
      nonce: randomUUID()
    };
    const command: WorkerCommand = { ...unsigned, signature: sign(unsigned, this.input.secret) };
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.input.socketPath);
      let buffer = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('SQL_WORKER_TIMEOUT'));
      }, 10_000);
      socket.on('connect', () => socket.write(frame(command)));
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 4) return;
        const length = buffer.readUInt32BE(0);
        if (length > 1_048_576 || buffer.length < length + 4) return;
        clearTimeout(timeout);
        socket.end();
        try {
          const response = JSON.parse(
            buffer.subarray(4, length + 4).toString('utf8')
          ) as WorkerResponse;
          if (response.commandId !== command.commandId)
            throw new Error('SQL_WORKER_RESPONSE_MISMATCH');
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
}
