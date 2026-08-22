# Drizzle model

`schema.ts` and `relations.ts` are generated from the live PostgreSQL database by
`npm run db:pull`. They are the typed query model for the application.

The deployment source of truth remains `db/migrations/*.sql`. Do not run the
generated `0000_*.sql` against an EduTrack database: Drizzle introspection does
not reproduce the project functions, triggers, and every specialized index.

`scripts/normalize-drizzle-pull.mjs` fixes a Drizzle Kit 0.31 empty-string
default rendering bug after every pull. `npm run typecheck` must pass after a
refresh.
