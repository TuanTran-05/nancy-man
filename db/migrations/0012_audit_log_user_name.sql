-- 0012_audit_log_user_name.sql
-- Giu ten nguoi thao tac tai THOI DIEM ghi audit. Khong suy lai tu users:
-- display_name co the doi, va mot so log lich su den tu tai khoan da bi xoa.

BEGIN;

ALTER TABLE audit_logs ADD COLUMN user_name TEXT;

COMMENT ON COLUMN audit_logs.user_name IS
  'Ban sao userName cua Firestore audit_logs; ten lich su tai thoi diem ghi log, khong dat FK.';

COMMIT;
