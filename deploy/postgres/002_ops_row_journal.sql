\set ON_ERROR_STOP on

\echo 'RETIRED: do not execute this file.'
\echo 'It attached row-journal triggers to every table in a schema and is unsafe.'
\echo 'Use the app migration db/migrations/0020_ops_execution_journal.sql together with deploy/postgres/002_ops_mutation_roles.sql.'
\quit
