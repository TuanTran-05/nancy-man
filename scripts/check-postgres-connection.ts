import { count } from 'drizzle-orm';
import { students } from '../db/drizzle/schema.js';
import { checkSqlConnection, closeSqlDb, getSqlDb } from '../server/db/client.js';

try {
  const health = await checkSqlConnection();
  const [studentCount] = await getSqlDb().select({ count: count() }).from(students);
  const version = health.serverVersion.match(/^PostgreSQL\s+\S+/)?.[0] || health.serverVersion;

  console.log(`OK ${health.database} as ${health.user} (${version})`);
  console.log(`OK students = ${studentCount?.count ?? 0}`);
} finally {
  await closeSqlDb();
}
