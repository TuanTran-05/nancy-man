import { createServer } from 'node:net';
import { chmod, unlink } from 'node:fs/promises';
import type {
  WorkerCommand,
  WorkerResponse
} from '../../../../packages/contracts/src/workerProtocol.js';
import { authenticateWorkerCommand } from './authenticateCommand.js';
import { encodeFrame, FrameDecoder } from './framing.js';

export async function startWorkerProtocolServer(input: {
  path: string;
  secret: string;
  consumeNonce: (nonce: string) => Promise<boolean>;
  handle: (command: WorkerCommand) => Promise<unknown>;
}) {
  await unlink(input.path).catch(() => undefined);
  const server = createServer((socket) => {
    const decoder = new FrameDecoder();
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on('data', async (chunk: Buffer) => {
      try {
        for (const value of decoder.push(chunk)) {
          const command = value as WorkerCommand;
          const valid = await authenticateWorkerCommand({
            command,
            secret: input.secret,
            consumeNonce: (nonce) => input.consumeNonce(`sql-worker:${nonce}`)
          });
          const response: WorkerResponse = valid
            ? {
                protocolVersion: 1,
                commandId: command.commandId,
                ok: true,
                result: await input.handle(command)
              }
            : {
                protocolVersion: 1,
                commandId: command?.commandId ?? 'unknown',
                ok: false,
                error: { code: 'WORKER_COMMAND_DENIED', safeMessage: 'Command denied' }
              };
          socket.write(encodeFrame(response));
        }
      } catch {
        socket.write(
          encodeFrame({
            protocolVersion: 1,
            commandId: 'unknown',
            ok: false,
            error: { code: 'WORKER_PROTOCOL_ERROR', safeMessage: 'Invalid worker protocol message' }
          } satisfies WorkerResponse)
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.path, () => resolve());
  });
  await chmod(input.path, 0o660);
  return {
    close: async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}
