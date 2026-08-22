type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

export class PostgresSourceMapStorage {
  constructor(
    private readonly database: QueryDatabase,
    private readonly objectStore: { get: (objectKey: string) => Promise<string | null> }
  ) {}

  async find(input: {
    serviceName: string;
    release: string;
    generatedFile: string;
  }): Promise<{ content: string; sha256: string } | null> {
    const { rows } = await this.database.query<{ objectKey: string; sha256: string }>(
      `
        SELECT source_map_objects.object_key AS "objectKey", source_map_objects.sha256
        FROM source_map_objects
        JOIN releases ON releases.id = source_map_objects.release_id
        WHERE releases.service_name = $1
          AND releases.release_sha = $2
          AND source_map_objects.generated_file = $3
        LIMIT 1
      `,
      [input.serviceName, input.release, input.generatedFile]
    );
    const sourceMap = rows[0];
    if (!sourceMap) return null;
    const content = await this.objectStore.get(sourceMap.objectKey);
    return content ? { content, sha256: sourceMap.sha256 } : null;
  }
}
