const partitionPattern = /^(error_events|ingest_envelopes)_(\d{4})(\d{2})$/;

function partitionEnd(value: string): Date | null {
  const match = partitionPattern.exec(value);
  if (!match) return null;
  const year = Number(match[2]);
  const month = Number(match[3]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month, 1));
}

export function planEventPartitionRetention(input: {
  now: Date;
  partitions: readonly string[];
  retentionDays?: number;
}): { drop: string[]; keep: string[] } {
  const cutoff = input.now.getTime() - (input.retentionDays ?? 90) * 24 * 60 * 60 * 1_000;
  const drop: string[] = [];
  const keep: string[] = [];
  for (const partition of input.partitions) {
    const end = partitionEnd(partition);
    if (end && end.getTime() <= cutoff) {
      drop.push(partition);
    } else {
      keep.push(partition);
    }
  }
  return { drop: drop.sort(), keep: keep.sort() };
}

export async function runEventPartitionRetention(input: {
  database: {
    query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  now?: Date;
  retentionDays?: number;
}): Promise<{ dropped: string[]; kept: string[] }> {
  const { rows } = await input.database.query<{ partitionName: string }>(
    `
      SELECT child.relname AS "partitionName"
      FROM pg_inherits
      JOIN pg_class AS parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class AS child ON pg_inherits.inhrelid = child.oid
      WHERE parent.relname IN ('error_events', 'ingest_envelopes')
    `
  );
  const plan = planEventPartitionRetention({
    now: input.now ?? new Date(),
    ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
    partitions: rows.map((row) => row.partitionName)
  });
  for (const partition of plan.drop) {
    await input.database.query(`DROP TABLE IF EXISTS ${partition}`);
  }
  return { dropped: plan.drop, kept: plan.keep };
}
