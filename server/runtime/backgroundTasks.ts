const pendingTasks = new Set<Promise<void>>();

/**
 * Keep post-response work alive in the persistent Node process and make it
 * visible to graceful shutdown. Rejections are consumed here so a background
 * task can never become an unhandled rejection.
 */
export function runInBackground(promise: Promise<unknown>, label = 'background-task'): void {
  const tracked = Promise.resolve(promise).then(
    () => undefined,
    (error) => {
      console.error(`[${label}-failed]`, error instanceof Error ? error.message : String(error));
    }
  );
  pendingTasks.add(tracked);
  void tracked.finally(() => pendingTasks.delete(tracked));
}

export function getBackgroundTaskCount(): number {
  return pendingTasks.size;
}

/** Wait for all work known at call time, including work it schedules. */
export async function drainBackgroundTasks(timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (pendingTasks.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      Promise.all([...pendingTasks]).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), remaining);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!completed) return false;
  }
  return true;
}
