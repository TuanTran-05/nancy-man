const claimReleaseIntervalMs = 60_000;

export async function runProcessorDaemon(input: {
  pollIntervalMs: number;
  releaseExpiredClaims: (now: Date) => Promise<void>;
  runOnce: () => Promise<{ processed: boolean; retried?: boolean }>;
  wait: (milliseconds: number) => Promise<void>;
  shouldStop: () => boolean;
  now?: () => Date;
}): Promise<void> {
  const now = input.now ?? (() => new Date());
  let lastClaimReleaseAt = Number.NEGATIVE_INFINITY;

  while (!input.shouldStop()) {
    const startedAt = now();
    if (startedAt.getTime() - lastClaimReleaseAt >= claimReleaseIntervalMs) {
      await input.releaseExpiredClaims(startedAt);
      lastClaimReleaseAt = startedAt.getTime();
    }

    const result = await input.runOnce();
    if (!result.processed) {
      await input.wait(input.pollIntervalMs);
    }
  }
}
