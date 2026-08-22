import { createServer } from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import type {
  WorkerCommand,
  WorkerResponse
} from '../../../../packages/contracts/src/workerProtocol.js';
import { authenticateWorkerCommand } from './authenticateCommand.js';
import { encodeFrame, FrameDecoder } from './framing.js';

async function removeStaleSocket(path: string): Promise<void> {
  try {
    const details = await lstat(path);
    if (!details.isSocket()) {
      throw new Error('Worker socket path exists and is not a socket');
    }
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

function commandFailure(commandId: string, error: unknown): WorkerResponse {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{2,79}$/.test(error.code)
      ? error.code
      : 'WORKER_COMMAND_FAILED';
  return {
    protocolVersion: 1,
    commandId,
    ok: false,
    error: { code, safeMessage: 'Command could not be processed' }
  };
}

export async function startWorkerProtocolServer(input: {
  path: string;
  secret: string;
  consumeNonce: (nonce: string) => Promise<boolean>;
  handle: (command: WorkerCommand) => Promise<unknown>;
}) {
  await removeStaleSocket(input.path);
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
          let response: WorkerResponse;
          if (!valid) {
            response = {
              protocolVersion: 1,
              commandId: command?.commandId ?? 'unknown',
              ok: false,
              error: { code: 'WORKER_COMMAND_DENIED', safeMessage: 'Command denied' }
            };
          } else {
            try {
              response = {
                protocolVersion: 1,
                commandId: command.commandId,
                ok: true,
                result: await input.handle(command)
              };
            } catch (error) {
              response = commandFailure(command.commandId, error);
            }
          }
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
