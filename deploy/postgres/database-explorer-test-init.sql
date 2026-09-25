\set ON_ERROR_STOP on
\getenv setup_login DATABASE_EXPLORER_TEST_LOGIN
\getenv create_existing_login DATABASE_EXPLORER_TEST_CREATE_EXISTING_LOGIN
\getenv fixture_script_path DATABASE_EXPLORER_TEST_FIXTURE_SCRIPT

CREATE ROLE explorer_fixture_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE explorer_unapproved_creator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE ops_database_browser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE explorer_stale_capability_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE explorer_stale_capability_dependent NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT ops_database_browser TO explorer_stale_capability_admin WITH ADMIN OPTION;
GRANT explorer_stale_capability_admin TO explorer_stale_capability_dependent;

\if :create_existing_login
CREATE ROLE :"setup_login" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE explorer_unexpected_login_group NOLOGIN;
GRANT pg_read_all_data TO :"setup_login";
GRANT explorer_unexpected_login_group TO :"setup_login";
\endif

CREATE DATABASE edutrack_production;
CREATE DATABASE edutrack_ops;

\connect edutrack_production
\set fixture_target 'edutrack_production'
\i :fixture_script_path

\connect edutrack_ops
\set fixture_target 'ops'
\i :fixture_script_path
