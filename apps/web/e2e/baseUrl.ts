export interface OpsE2eBaseUrl {
  baseURL: string;
  origin: string;
  port: number;
}

export function parseOpsE2eBaseUrl(value: string | undefined): OpsE2eBaseUrl {
  if (!value) throw new Error('OPS_E2E_BASE_URL is required');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('OPS_E2E_BASE_URL must use a verified-unused high loopback port');
  }
  const port = Number(parsed.port);
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !Number.isInteger(port) ||
    port < 49_152 ||
    port > 65_535 ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('OPS_E2E_BASE_URL must use a verified-unused high loopback port');
  }
  return { baseURL: parsed.origin, origin: parsed.origin, port };
}
