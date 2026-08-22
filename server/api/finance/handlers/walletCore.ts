import { finiteMoney } from '../../../../shared/money.js';

function taggedError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Pure planner for voiding a posted wallet deposit. Refuses when the wallet
 * no longer holds the money — allocations must be voided first (spec D3).
 */
export function planWalletDepositVoid(input: {
  walletTx: Record<string, unknown> | undefined;
  /** undefined when the student doc is gone — the caller cannot update it. */
  student: Record<string, unknown> | undefined;
  reason: string;
}): { newBalance: number; amount: number } {
  if (!input.walletTx) throw taggedError('Wallet transaction not found', 404);
  if (!input.student) throw taggedError('Student not found', 404);
  if (!String(input.reason || '').trim()) throw taggedError('A void reason is required', 400);
  if (String(input.walletTx.type) !== 'deposit') {
    throw taggedError('Only deposits can be voided here', 400);
  }
  if (String(input.walletTx.status) !== 'posted') {
    throw taggedError('Only posted deposits can be voided', 400);
  }
  const amount = finiteMoney(input.walletTx.amount);
  const balance = finiteMoney(input.student.walletBalance);
  if (balance < amount) {
    throw taggedError(
      'Wallet balance is lower than this deposit — void the allocations that spent it first',
      400
    );
  }
  return { newBalance: balance - amount, amount };
}
