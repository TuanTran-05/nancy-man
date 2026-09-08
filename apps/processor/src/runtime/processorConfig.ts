type Environment = Readonly<Record<string, string | undefined>>;

const defaultPollIntervalMs = 250;
const defaultMaxAttempts = 10;

export function readProcessorPollInterval(environment: Environment): number {
  const configured = environment.OPS_PROCESSOR_POLL_MS;
  if (configured === undefined) return defaultPollIntervalMs;
  if (!/^[0-9]{1,4}$/.test(configured)) {
    throw new Error('OPS_PROCESSOR_POLL_MS must be a whole-number poll interval');
  }
  const pollIntervalMs = Number(configured);
  if (pollIntervalMs < 50 || pollIntervalMs > 5_000) {
    throw new Error('OPS_PROCESSOR_POLL_MS must be between 50 and 5000 milliseconds');
  }
  return pollIntervalMs;
}

export function readProcessorMaxAttempts(environment: Environment): number {
  const configured = environment.OPS_PROCESSOR_MAX_ATTEMPTS;
  if (configured === undefined) return defaultMaxAttempts;
  if (!/^[0-9]{1,3}$/.test(configured)) {
    throw new Error('OPS_PROCESSOR_MAX_ATTEMPTS must be a whole-number retry limit');
  }
  const maxAttempts = Number(configured);
  if (maxAttempts < 1 || maxAttempts > 100) {
    throw new Error('OPS_PROCESSOR_MAX_ATTEMPTS must be between 1 and 100 attempts');
  }
  return maxAttempts;
}
