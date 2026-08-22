CREATE TABLE IF NOT EXISTS error_issue_affected_users (
  issue_id uuid NOT NULL REFERENCES error_issues(id) ON DELETE RESTRICT,
  user_reference text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  PRIMARY KEY (issue_id, user_reference)
);
