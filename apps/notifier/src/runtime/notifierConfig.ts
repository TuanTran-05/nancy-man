type Environment = Readonly<Record<string, string | undefined>>;

export function readNotifierPollInterval(environment: Environment): number {
  const configured = environment.OPS_NOTIFIER_POLL_MS;
  if (configured === undefined) return 1_000;
  if (!/^[0-9]{1,4}$/.test(configured)) {
    throw new Error('OPS_NOTIFIER_POLL_MS must be a whole-number poll interval');
  }
  const pollIntervalMs = Number(configured);
  if (pollIntervalMs < 250 || pollIntervalMs > 5_000) {
    throw new Error('OPS_NOTIFIER_POLL_MS must be between 250 and 5000 milliseconds');
  }
  return pollIntervalMs;
}
