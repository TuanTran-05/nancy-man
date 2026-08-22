import { PayOS } from '@payos/node';

let payos: PayOS | null = null;

export function getPayOSClient(): PayOS {
  const clientId = process.env.PAYOS_CLIENT_ID || '';
  const apiKey = process.env.PAYOS_API_KEY || '';
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY || '';

  if (!clientId || !apiKey || !checksumKey) {
    throw new Error('payOS is not configured');
  }

  if (!payos) {
    payos = new PayOS({ clientId, apiKey, checksumKey });
  }

  return payos;
}
