import { chmod, copyFile, mkdir, readdir } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { join } from 'node:path';

export async function copyDatabaseMigrations(input) {
  const entries = await readdir(input.sourceDirectory, { withFileTypes: true });
  await mkdir(input.destinationDirectory, { recursive: true, mode: 0o755 });
  await chmod(input.destinationDirectory, 0o755);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^\d{4}_[A-Za-z0-9_]+\.sql$/.test(entry.name))
      .map((entry) =>
        copyFile(
          join(input.sourceDirectory, entry.name),
          join(input.destinationDirectory, entry.name)
        )
      )
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sourceDirectory = fileURLToPath(
    new URL('../../../packages/db/migrations/', import.meta.url)
  );
  const destinationDirectory = fileURLToPath(
    new URL('../dist/packages/db/migrations/', import.meta.url)
  );
  await copyDatabaseMigrations({ sourceDirectory, destinationDirectory });
}
