type Environment = Readonly<Record<string, string | undefined>>;

const defaultPollIntervalMs = 250;

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
