import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WorkerCommand } from '../../../../packages/contracts/src/workerProtocol.js';
function payload(command: Omit<WorkerCommand, 'signature'>): string {
  return JSON.stringify(command);
}
export function signWorkerCommand(
  command: Omit<WorkerCommand, 'signature'>,
  secret: string
): string {
  return createHmac('sha256', secret).update(payload(command), 'utf8').digest('hex');
}
export async function authenticateWorkerCommand(input: {
  command: WorkerCommand;
  secret: string;
  consumeNonce: (nonce: string) => Promise<boolean>;
  now?: Date;
}): Promise<boolean> {
  const { signature, ...unsigned } = input.command;
  const expected = Buffer.from(signWorkerCommand(unsigned, input.secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  const issuedAt = Date.parse(input.command.issuedAt);
  const now = (input.now ?? new Date()).getTime();
  if (
    !Number.isFinite(issuedAt) ||
    Math.abs(now - issuedAt) > 60_000 ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    return false;
  return input.consumeNonce(input.command.nonce);
}
