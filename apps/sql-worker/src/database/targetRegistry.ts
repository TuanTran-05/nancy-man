import {
  type DatabaseTargetId,
  type DatabaseTargetSummary,
  isDatabaseTargetId
} from '../../../../packages/contracts/src/databaseExplorer.js';

export type TargetPool = {
  query: <T>(
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
  connect: () => Promise<{
    query: <T>(
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: T[]; rowCount?: number | null }>;
    release: (error?: Error | boolean) => void;
  }>;
  end: () => Promise<void>;
};

export type AvailableTargetEntry = {
  id: DatabaseTargetId;
  label: string;
  status: 'available';
  pool: TargetPool;
  databaseName: string;
  role: string;
};

export type UnavailableTargetEntry = {
  id: DatabaseTargetId;
  label: string;
  status: 'unavailable';
  code: string;
  error?: unknown;
};

export type DisabledTargetEntry = {
  id: DatabaseTargetId;
  label: string;
  status: 'disabled';
};

export type TargetEntry = AvailableTargetEntry | UnavailableTargetEntry | DisabledTargetEntry;

export interface DatabaseTargetRegistry {
  get(targetId: string): AvailableTargetEntry;
  summaries(): Promise<DatabaseTargetSummary[]>;
  all(): TargetEntry[];
}

export type TargetRegistryOptions = {
  now?: () => number;
  probeTimeoutMs?: number;
  probe?: (target: AvailableTargetEntry, signal: AbortSignal) => Promise<void>;
};

const TARGET_HEALTH_INTERVAL_MS = 5_000;
const TARGET_HEALTH_QUERY_TIMEOUT_MS = 1_000;

type TargetState = {
  entry: TargetEntry;
  status: TargetEntry['status'];
  lastProbeAt: number;
  latestProbeId: number;
  activeProbes: number;
  inFlight: Promise<void> | undefined;
};

function createProbeTimeoutError(): Error {
  return Object.assign(new Error('DATABASE_TARGET_PROBE_TIMEOUT'), {
    code: 'DATABASE_TARGET_PROBE_TIMEOUT'
  });
}

async function probeTarget(target: AvailableTargetEntry, signal: AbortSignal): Promise<void> {
  let client: Awaited<ReturnType<TargetPool['connect']>> | undefined;
  let released = false;
  const release = (error?: Error): void => {
    if (!client || released) return;
    released = true;
    client.release(error);
  };
  const onAbort = (): void => {
    const error = signal.reason instanceof Error ? signal.reason : createProbeTimeoutError();
    release(error);
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    client = await target.pool.connect();
    if (signal.aborted) {
      onAbort();
      throw signal.reason instanceof Error ? signal.reason : createProbeTimeoutError();
    }
    const query = client.query as unknown as (
      this: Awaited<ReturnType<TargetPool['connect']>>,
      config: { text: string; query_timeout: number }
    ) => Promise<{ rows: unknown[] }>;
    await query.call(client, {
      text: 'SELECT 1',
      query_timeout: TARGET_HEALTH_QUERY_TIMEOUT_MS
    });
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : createProbeTimeoutError();
    }
  } catch (error) {
    release(error instanceof Error ? error : createProbeTimeoutError());
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    release();
  }
}

export function createTargetRegistry(
  entries: readonly TargetEntry[],
  options: TargetRegistryOptions = {}
): DatabaseTargetRegistry {
  const now = options.now ?? Date.now;
  const probe = options.probe ?? probeTarget;
  const probeTimeoutMs = options.probeTimeoutMs ?? TARGET_HEALTH_QUERY_TIMEOUT_MS;
  // A timed-out injected probe may ignore abort; permit one recovery attempt without unbounded orphans.
  const maxActiveProbes = 2;
  const states = new Map<DatabaseTargetId, TargetState>();
  for (const entry of entries) {
    states.set(entry.id, {
      entry,
      status: entry.status,
      lastProbeAt: now(),
      latestProbeId: 0,
      activeProbes: 0,
      inFlight: undefined
    });
  }

  const unavailableError = (code: string): Error => {
    const err = new Error(code) as Error & { code: string };
    err.code = code;
    return err;
  };

  const refresh = (state: TargetState): Promise<void> | undefined => {
    if (state.entry.status !== 'available') return undefined;
    if (state.inFlight) return state.inFlight;
    const probeStartedAt = now();
    if (probeStartedAt - state.lastProbeAt < TARGET_HEALTH_INTERVAL_MS) return undefined;
    if (state.activeProbes >= maxActiveProbes) return undefined;

    state.lastProbeAt = probeStartedAt;
    const probeId = ++state.latestProbeId;
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let resolveDeadline: (() => void) | undefined;
    const deadline = new Promise<void>((resolve) => {
      resolveDeadline = resolve;
    });
    let timedOut = false;
    state.activeProbes++;
    let boundedProbe: Promise<void>;
    const operation = Promise.resolve()
      .then(() => probe(state.entry as AvailableTargetEntry, controller.signal))
      .then(
        () => {
          if (probeId === state.latestProbeId && !timedOut) state.status = 'available';
        },
        () => {
          if (probeId === state.latestProbeId) state.status = 'unavailable';
        }
      )
      .finally(() => {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        state.activeProbes--;
      });
    boundedProbe = Promise.race([operation, deadline]);
    state.inFlight = boundedProbe;
    void boundedProbe.then(() => {
      if (state.inFlight === boundedProbe) state.inFlight = undefined;
    });
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (probeId === state.latestProbeId) state.status = 'unavailable';
      controller.abort(createProbeTimeoutError());
      resolveDeadline?.();
    }, probeTimeoutMs);
    return boundedProbe;
  };

  const visibleEntry = (state: TargetState): TargetEntry => {
    if (state.entry.status !== 'available' || state.status === 'available') return state.entry;
    return {
      id: state.entry.id,
      label: state.entry.label,
      status: 'unavailable',
      code: 'DATABASE_TARGET_UNAVAILABLE'
    };
  };

  return {
    get(targetId: string): AvailableTargetEntry {
      if (!isDatabaseTargetId(targetId)) {
        const err = new Error('DATABASE_TARGET_INVALID') as Error & { code: string };
        err.code = 'DATABASE_TARGET_INVALID';
        throw err;
      }

      const state = states.get(targetId);
      if (!state || state.status === 'disabled') {
        throw unavailableError('DATABASE_TARGET_UNAVAILABLE');
      }

      if (state.status === 'unavailable') {
        const code =
          state.entry.status === 'unavailable'
            ? state.entry.code || 'DATABASE_TARGET_UNAVAILABLE'
            : 'DATABASE_TARGET_UNAVAILABLE';
        throw unavailableError(code);
      }

      if (state.entry.status !== 'available') {
        throw unavailableError('DATABASE_TARGET_UNAVAILABLE');
      }
      return state.entry;
    },

    async summaries(): Promise<DatabaseTargetSummary[]> {
      await Promise.all([...states.values()].map((state) => refresh(state)));
      return [...states.values()].map(({ entry, status }) => ({
        id: entry.id,
        label: entry.label,
        status,
        readOnly: true,
        ...(status === 'unavailable'
          ? {
              unavailableReason:
                entry.status === 'unavailable' ? entry.code : 'DATABASE_TARGET_UNAVAILABLE'
            }
          : {})
      }));
    },

    all(): TargetEntry[] {
      return [...states.values()].map(visibleEntry);
    }
  };
}
