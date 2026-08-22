const PAYOS_REQUIRED_VARS = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'] as const;

export function isPayOSEnabled(): boolean {
  return (
    process.env.PAYOS_ENABLED === 'true' &&
    PAYOS_REQUIRED_VARS.every((variable) => Boolean(process.env[variable]?.trim()))
  );
}
