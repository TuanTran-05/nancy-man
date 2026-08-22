import { type OpsRuntimeDatabase } from './createOpsApiRuntime.js';

type PoolClient = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
};

type Pool = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
  connect: () => Promise<PoolClient>;
};

export function createPoolDatabase(pool: Pool): OpsRuntimeDatabase {
  return {
    query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
      const result = await pool.query<T>(sql, parameters);
      return { rows: result.rows };
    },
    transaction: async <T>(
      operation: (database: { query: OpsRuntimeDatabase['query'] }) => Promise<T>
    ) => {
      const client = await pool.connect();
      const database = {
        query: async <R>(sql: string, parameters: readonly unknown[] = []) => {
          const result = await client.query<R>(sql, parameters);
          return { rows: result.rows };
        }
      };
      try {
        await client.query('BEGIN');
        const result = await operation(database);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
