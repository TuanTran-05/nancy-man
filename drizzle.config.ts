import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Use an SSH tunnel for the VPS database; do not expose PostgreSQL port 5432 publicly.'
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/drizzle/schema.ts',
  out: './db/drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
  schemaFilter: ['public'],
  tablesFilter: ['*'],
  introspect: {
    casing: 'camel',
  },
  strict: true,
  verbose: true,
});
