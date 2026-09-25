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
  summaries(): DatabaseTargetSummary[];
  all(): TargetEntry[];
}

export function createTargetRegistry(entries: readonly TargetEntry[]): DatabaseTargetRegistry {
  const map = new Map<DatabaseTargetId, TargetEntry>();
  for (const entry of entries) {
    map.set(entry.id, entry);
  }

  return {
    get(targetId: string): AvailableTargetEntry {
      if (!isDatabaseTargetId(targetId)) {
        const err = new Error('DATABASE_TARGET_INVALID') as Error & { code: string };
        err.code = 'DATABASE_TARGET_INVALID';
        throw err;
      }

      const target = map.get(targetId);
      if (!target || target.status === 'disabled') {
        const err = new Error('DATABASE_TARGET_UNAVAILABLE') as Error & { code: string };
        err.code = 'DATABASE_TARGET_UNAVAILABLE';
        throw err;
      }

      if (target.status === 'unavailable') {
        const code = target.code || 'DATABASE_TARGET_UNAVAILABLE';
        const err = new Error(code) as Error & { code: string };
        err.code = code;
        throw err;
      }

      return target;
    },

    summaries(): DatabaseTargetSummary[] {
      return entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        status: entry.status,
        readOnly: true,
        ...(entry.status === 'unavailable' ? { unavailableReason: entry.code } : {})
      }));
    },

    all(): TargetEntry[] {
      return [...entries];
    }
  };
}
