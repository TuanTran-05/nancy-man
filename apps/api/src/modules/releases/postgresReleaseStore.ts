import { randomUUID } from 'node:crypto';

type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type PublisherStatus = 'active' | 'disabled' | 'rotated';

export class SourceMapRegistrationConflictError extends Error {
  constructor() {
    super('A different source map is already registered for this release asset');
  }
}

export class PostgresReleasePublisherStore {
  constructor(private readonly database: QueryDatabase) {}

  async findPublisher(keyId: string): Promise<{
    serviceName: string;
    secretReference: string;
    status: PublisherStatus;
  } | null> {
    const { rows } = await this.database.query<{
      serviceName: string;
      secretReference: string;
      status: PublisherStatus;
    }>(
      `
        SELECT
          service_name AS "serviceName",
          secret_reference AS "secretReference",
          status
        FROM release_publishers
        WHERE key_id = $1
        LIMIT 1
      `,
      [keyId]
    );
    return rows[0] ?? null;
  }
}

export class PostgresReleaseRepository {
  constructor(private readonly database: QueryDatabase) {}

  async upsertRelease(input: {
    serviceName: string;
    releaseSha: string;
    buildId: string;
    deployedAt: Date;
  }): Promise<{ id: string }> {
    const { rows } = await this.database.query<{ id: string }>(
      `
        INSERT INTO releases (id, service_name, release_sha, build_id, deployed_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (service_name, release_sha) DO UPDATE
          SET build_id = EXCLUDED.build_id,
              deployed_at = EXCLUDED.deployed_at
        RETURNING id
      `,
      [randomUUID(), input.serviceName, input.releaseSha, input.buildId, input.deployedAt]
    );
    const release = rows[0];
    if (!release) throw new Error('Release registration did not return an identifier');
    return release;
  }

  async recordSourceMap(input: {
    releaseId: string;
    objectKey: string;
    sha256: string;
    generatedFile: string;
  }): Promise<void> {
    const { rows } = await this.database.query<{ sha256: string }>(
      `
        INSERT INTO source_map_objects (
          id,
          release_id,
          object_key,
          sha256,
          generated_file,
          storage_provider
        ) VALUES ($1, $2, $3, $4, $5, 'ops_object_store')
        ON CONFLICT (release_id, generated_file) DO UPDATE
          SET object_key = source_map_objects.object_key
          WHERE source_map_objects.sha256 = EXCLUDED.sha256
            AND source_map_objects.object_key = EXCLUDED.object_key
        RETURNING sha256
      `,
      [randomUUID(), input.releaseId, input.objectKey, input.sha256, input.generatedFile]
    );
    if (!rows[0]) throw new SourceMapRegistrationConflictError();
  }
}
