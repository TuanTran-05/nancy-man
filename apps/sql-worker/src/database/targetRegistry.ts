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
    release: () => void;
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
  probe?: (target: AvailableTargetEntry) => Promise<void>;
};

const TARGET_HEALTH_INTERVAL_MS = 5_000;
const TARGET_HEALTH_QUERY_TIMEOUT_MS = 1_000;

type TargetState = {
  entry: TargetEntry;
  status: TargetEntry['status'];
  lastProbeAt: number;
  inFlight: Promise<void> | undefined;
  timedOut: boolean;
};

async function probeTarget(target: AvailableTargetEntry): Promise<void> {
  const query = target.pool.query as unknown as (
    this: TargetPool,
    config: { text: string; query_timeout: number }
  ) => Promise<{ rows: unknown[] }>;
  await query.call(target.pool, {
    text: 'SELECT 1',
    query_timeout: TARGET_HEALTH_QUERY_TIMEOUT_MS
  });
}

export function createTargetRegistry(
  entries: readonly TargetEntry[],
  options: TargetRegistryOptions = {}
): DatabaseTargetRegistry {
  const now = options.now ?? Date.now;
  const probe = options.probe ?? probeTarget;
  const probeTimeoutMs = options.probeTimeoutMs ?? TARGET_HEALTH_QUERY_TIMEOUT_MS;
  const states = new Map<DatabaseTargetId, TargetState>();
  for (const entry of entries) {
    states.set(entry.id, {
      entry,
      status: entry.status,
      lastProbeAt: now(),
      inFlight: undefined,
      timedOut: false
    });
  }

  const unavailableError = (code: string): Error => {
    const err = new Error(code) as Error & { code: string };
    err.code = code;
    return err;
  };

  const refresh = (state: TargetState): Promise<void> | undefined => {
    if (state.entry.status !== 'available') return undefined;
    if (state.inFlight) return state.timedOut ? undefined : state.inFlight;
    const probeStartedAt = now();
    if (probeStartedAt - state.lastProbeAt < TARGET_HEALTH_INTERVAL_MS) return undefined;

    state.lastProbeAt = probeStartedAt;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let resolveDeadline: (() => void) | undefined;
    const deadline = new Promise<void>((resolve) => {
      resolveDeadline = resolve;
    });
    const operation = Promise.resolve()
      .then(() => probe(state.entry as AvailableTargetEntry))
      .then(
        () => {
          if (!state.timedOut) state.status = 'available';
        },
        () => {
          state.status = 'unavailable';
        }
      )
      .finally(() => {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        state.inFlight = undefined;
        state.timedOut = false;
      });
    state.inFlight = operation;
    timeoutHandle = setTimeout(() => {
      state.timedOut = true;
      state.status = 'unavailable';
      resolveDeadline?.();
    }, probeTimeoutMs);
    return Promise.race([operation, deadline]);
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
