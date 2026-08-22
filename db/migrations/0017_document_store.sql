-- 0017_document_store.sql
-- PostgreSQL-backed document compatibility store for the legacy handler
-- surface. This lets the VPS cut over atomically without retaining Firestore.

BEGIN;

CREATE TABLE app_documents (
  collection_path TEXT NOT NULL,
  document_id     TEXT NOT NULL,
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_path, document_id),
  CONSTRAINT app_documents_collection_path CHECK (
    btrim(collection_path) <> '' AND collection_path !~ '(^/|/$|//)'
  ),
  CONSTRAINT app_documents_document_id CHECK (
    btrim(document_id) <> '' AND document_id !~ '/'
  )
);

CREATE INDEX app_documents_collection_idx
  ON app_documents (collection_path, updated_at DESC, document_id);
CREATE INDEX app_documents_data_gin_idx
  ON app_documents USING gin (data jsonb_path_ops);

COMMIT;
