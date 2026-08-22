-- 0005_finance.sql
-- Mien co rang buoc chat nhat, vi day la cho da mat tien.
--
-- Ba con so tong (paidTotal, discountTotal, siblingDiscountTotal) khong con la
-- cot. Chung chay song song voi chung tu ma khong gi buoc phai khop — do chinh
-- la co che sinh lech so du. Gio chung la VIEW tren receipt_allocations
-- (xem 0010_views.sql).
--
-- Do tren production 2026-08-19: ledger.paidTotal === SUM(allocations) tren
-- 739/739 hang, tong lech 0 dong. Tuc chuyen sang view khong mat gi.

BEGIN;

-- ---------------------------------------------------------------------------
-- course_fee_ledgers
-- ---------------------------------------------------------------------------
CREATE TABLE course_fee_ledgers (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id      TEXT NOT NULL REFERENCES classes (id)  ON DELETE RESTRICT,
  enrollment_id TEXT REFERENCES student_course_enrollments (id) ON DELETE RESTRICT,
  term_id       TEXT REFERENCES class_terms (id) ON DELETE RESTRICT,

  term_start    DATE,
  term_end      DATE,

  amount        NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  currency      TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND', 'USD')),

  -- status van la cot THAT, khong suy tu so tien: 'waived' la quyet dinh cua
  -- con nguoi, khong tinh ra duoc.
  status        TEXT NOT NULL CHECK (status IN ('unpaid', 'partial', 'paid', 'waived')),

  period_type   TEXT CHECK (period_type IN ('course', 'monthly')),
  month         TEXT CHECK (month IS NULL OR month ~ '^\d{4}-\d{2}$'),
  source        TEXT CHECK (source IN ('course', 'legacy_tuition')),
  due_date      DATE,
  note          TEXT,

  legacy_tuition_record_id TEXT,
  migration_run_id         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Rang buoc chan ledger trung — thay cho viec app phai tu dedupe theo bo ba
  -- moi lan doc. Do production: 0/739 vi pham.
  CONSTRAINT ledger_term_key UNIQUE (student_id, class_id, term_start),

  CONSTRAINT ledger_term_order CHECK (term_end IS NULL OR term_start IS NULL OR term_end >= term_start),
  -- Ky theo thang thi phai co thang; ky theo khoa thi phai co ngay bat dau.
  CONSTRAINT ledger_period_shape CHECK (
    period_type IS NULL
    OR (period_type = 'monthly' AND month IS NOT NULL)
    OR (period_type = 'course'  AND term_start IS NOT NULL)
  )
);

CREATE INDEX ledger_student_idx  ON course_fee_ledgers (student_id, term_start DESC);
CREATE INDEX ledger_class_idx    ON course_fee_ledgers (class_id, term_start DESC);
CREATE INDEX ledger_open_idx     ON course_fee_ledgers (status, due_date)
  WHERE status IN ('unpaid', 'partial');
CREATE INDEX ledger_enrollment_idx ON course_fee_ledgers (enrollment_id) WHERE enrollment_id IS NOT NULL;

COMMENT ON TABLE course_fee_ledgers IS
  'Doc ID cu la {studentId}_{classId}_{termStart}_{termEnd} — ID tung lech khoi chinh truong term cua no. Gio ID chi la chuoi mo, tinh duy nhat do ledger_term_key lo.';

-- ---------------------------------------------------------------------------
-- ledger_notice_log
-- ---------------------------------------------------------------------------
-- Thay 14 cot tuitionReminder* / tuitionNotice* de len nhau trong cung mot
-- document. Mot hang mot lan gui; dem so lan nhac thanh COUNT(*).
CREATE TABLE ledger_notice_log (
  id            TEXT PRIMARY KEY,
  ledger_id     TEXT NOT NULL REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  notice_kind   TEXT NOT NULL CHECK (notice_kind IN ('reminder', 'notice')),
  sent_at       TIMESTAMPTZ NOT NULL,
  sent_by       TEXT NOT NULL,
  source        TEXT CHECK (source IN ('evaluation', 'accounting', 'office', 'system')),
  amount        NUMERIC(14, 2) CHECK (amount >= 0),
  due_date      DATE,
  semester      TEXT,
  message_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ledger_notice_log_ledger_idx ON ledger_notice_log (ledger_id, sent_at DESC);

COMMENT ON TABLE ledger_notice_log IS
  'Bo cot tuitionNoticeLastSentByName / tuitionReminderLastSentByName (muc 1.7) — JOIN sang users.';

-- ---------------------------------------------------------------------------
-- student_wallets
-- ---------------------------------------------------------------------------
-- So du KHONG luu. Xem v_student_wallet_balance o 0010_views.sql.
CREATE TABLE student_wallets (
  student_id         TEXT PRIMARY KEY REFERENCES students (id) ON DELETE RESTRICT,
  opening_balance    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  history_started_at DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- receipts
-- ---------------------------------------------------------------------------
CREATE TABLE receipts (
  id                  TEXT PRIMARY KEY,
  receipt_no          TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'tuition' CHECK (type IN ('tuition')),
  wallet_deposit      BOOLEAN NOT NULL DEFAULT false,
  flow_version        TEXT,
  transaction_group_id TEXT,

  student_id          TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id            TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  ledger_id           TEXT REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  invoice_id          TEXT,

  amount_received     NUMERIC(14, 2) NOT NULL CHECK (amount_received >= 0),
  currency            TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND', 'USD')),
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'other')),
  received_date       DATE NOT NULL,

  status              TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'void')),
  note                TEXT NOT NULL DEFAULT '',

  source              TEXT CHECK (source IN ('manual', 'payos', 'migration')),
  payment_request_id  TEXT,
  payos_order_code    BIGINT,
  payos_payment_link_id TEXT,
  payos_reference     TEXT,
  payment_confirmation_source TEXT
                      CHECK (payment_confirmation_source IN ('webhook', 'gateway_status', 'gateway_reconcile')),
  notification_skipped_reason TEXT,

  created_by          TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_by_role     TEXT NOT NULL,
  void_reason         TEXT,
  voided_at           TIMESTAMPTZ,
  voided_by           TEXT REFERENCES users (id) ON DELETE RESTRICT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- So bien lai cap bang SEQUENCE (0001) thay cho counterSequence.ts chay
  -- transaction tren Firestore.
  CONSTRAINT receipts_receipt_no_key UNIQUE (receipt_no),

  CONSTRAINT receipt_void_complete CHECK (
    status <> 'void' OR (voided_at IS NOT NULL AND voided_by IS NOT NULL)
  )
);

CREATE INDEX receipts_student_idx ON receipts (student_id, received_date DESC);
CREATE INDEX receipts_date_idx    ON receipts (received_date DESC) WHERE status = 'posted';
CREATE INDEX receipts_group_idx   ON receipts (transaction_group_id) WHERE transaction_group_id IS NOT NULL;

COMMENT ON TABLE receipts IS
  'Bo: createdByName, voidedByName (muc 1.7, JOIN sang users); classIds[] va walletBalanceBefore/After (suy duoc tu receipt_allocations va wallet_transactions).';

-- ---------------------------------------------------------------------------
-- receipt_allocations
-- ---------------------------------------------------------------------------
-- Day la bang khien paidTotal tro thanh dan xuat duoc.
CREATE TABLE receipt_allocations (
  id                      TEXT PRIMARY KEY,
  receipt_id              TEXT NOT NULL REFERENCES receipts (id) ON DELETE RESTRICT,
  ledger_id               TEXT NOT NULL REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  class_id                TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  amount                  NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),

  discount_type           TEXT CHECK (discount_type IN
                            ('none', 'first_prize', 'second_prize', 'full_waiver', 'hardship', 'custom')),
  discount_amount         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_percent        NUMERIC(5, 2) CHECK (discount_percent BETWEEN 0 AND 100),
  discount_reason         TEXT,

  sibling_discount        BOOLEAN NOT NULL DEFAULT false,
  sibling_discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (sibling_discount_amount >= 0),
  sibling_discount_waived BOOLEAN NOT NULL DEFAULT false,
  sibling_discount_waived_reason TEXT,

  CONSTRAINT receipt_allocation_key UNIQUE (receipt_id, ledger_id),
  -- Phan giam gia anh em la mot phan cua tong giam gia, khong the vuot qua no.
  CONSTRAINT sibling_within_discount CHECK (sibling_discount_amount <= discount_amount)
);

CREATE INDEX receipt_allocations_ledger_idx ON receipt_allocations (ledger_id);

COMMENT ON TABLE receipt_allocations IS
  'Bo cac cot newPaidTotal / newStatus / newDiscountTotal / newSiblingDiscountTotal / originalAmount: chung la anh chup trang thai sau khi ghi, tinh lai duoc tu v_ledger_totals.';

-- ---------------------------------------------------------------------------
-- wallet_transactions
-- ---------------------------------------------------------------------------
CREATE TABLE wallet_transactions (
  id                   TEXT PRIMARY KEY,
  schema_version       SMALLINT NOT NULL DEFAULT 2,
  transaction_group_id TEXT,
  group_sequence       SMALLINT CHECK (group_sequence >= 0),
  source               TEXT CHECK (source IN ('manual_receipt', 'manual_allocation', 'student_refund')),

  student_id           TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  type                 TEXT NOT NULL
                       CHECK (type IN ('deposit', 'allocation', 'credit', 'refund', 'adjustment')),
  -- Luat nghiep vu trong shared/wallet.ts: so tien luon duong, chieu di tu type.
  amount               NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency             TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND', 'USD')),
  direction            TEXT CHECK (direction IN ('in', 'out')),
  status               TEXT NOT NULL CHECK (status IN ('proposed', 'posted', 'rejected', 'void')),

  receipt_id           TEXT REFERENCES receipts (id) ON DELETE RESTRICT,
  ledger_id            TEXT REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  expense_id           TEXT,
  class_id             TEXT REFERENCES classes (id) ON DELETE RESTRICT,

  note                 TEXT NOT NULL DEFAULT '',
  reason               TEXT,

  created_by           TEXT NOT NULL,
  approved_by          TEXT REFERENCES users (id) ON DELETE RESTRICT,
  void_reason          TEXT,
  voided_at            TIMESTAMPTZ,
  voided_by            TEXT REFERENCES users (id) ON DELETE RESTRICT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at            TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- direction chi co nghia voi adjustment; cac type khac tu mang chieu roi.
  CONSTRAINT wallet_direction_scope CHECK (
    (type = 'adjustment' AND direction IS NOT NULL)
    OR (type <> 'adjustment' AND direction IS NULL)
  ),
  CONSTRAINT wallet_posted_has_time CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CONSTRAINT wallet_allocation_has_ledger CHECK (type <> 'allocation' OR ledger_id IS NOT NULL),
  CONSTRAINT wallet_void_complete CHECK (
    status <> 'void' OR (voided_at IS NOT NULL AND voided_by IS NOT NULL)
  )
);

CREATE INDEX wallet_tx_student_idx ON wallet_transactions (student_id, created_at DESC);
CREATE INDEX wallet_tx_posted_idx  ON wallet_transactions (student_id) WHERE status = 'posted';
CREATE INDEX wallet_tx_group_idx   ON wallet_transactions (transaction_group_id) WHERE transaction_group_id IS NOT NULL;
CREATE INDEX wallet_tx_ledger_idx  ON wallet_transactions (ledger_id) WHERE ledger_id IS NOT NULL;

COMMENT ON TABLE wallet_transactions IS
  'Bo createdByName, approvedByName, voidedByName (muc 1.7) va receiptNo (JOIN sang receipts).';

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
-- Cac cot *Snapshot o day KHONG phai cache: chung la bang chung phap ly ve
-- trang thai tai thoi diem phat hanh (ngoai le cua muc 1.7). Chung o lai va
-- KHONG JOIN lai.
CREATE TABLE invoices (
  id                       TEXT PRIMARY KEY,
  invoice_no               TEXT NOT NULL,
  ledger_id                TEXT NOT NULL REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  student_id               TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id                 TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  parent_uid               TEXT,
  currency                 TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  status                   TEXT NOT NULL
                           CHECK (status IN ('issued', 'partially_paid', 'paid', 'void', 'superseded')),
  amount_due               NUMERIC(14, 2) NOT NULL CHECK (amount_due >= 0),
  amount_paid              NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),

  ledger_amount_snapshot   NUMERIC(14, 2) NOT NULL,
  paid_total_snapshot      NUMERIC(14, 2) NOT NULL,
  discount_total_snapshot  NUMERIC(14, 2) NOT NULL,
  student_name_snapshot    TEXT NOT NULL,
  class_name_snapshot      TEXT NOT NULL,
  snapshot_version         INTEGER NOT NULL DEFAULT 1,

  issued_at                TIMESTAMPTZ NOT NULL,
  paid_at                  TIMESTAMPTZ,
  superseded_at            TIMESTAMPTZ,
  superseded_by_invoice_id TEXT REFERENCES invoices (id) ON DELETE RESTRICT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT invoices_no_key UNIQUE (invoice_no),
  CONSTRAINT invoice_superseded_pair CHECK ((superseded_at IS NULL) = (superseded_by_invoice_id IS NULL))
);

CREATE INDEX invoices_ledger_idx  ON invoices (ledger_id);
CREATE INDEX invoices_student_idx ON invoices (student_id, issued_at DESC);

CREATE TABLE invoice_line_items (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position    SMALLINT NOT NULL CHECK (position > 0),
  type        TEXT NOT NULL CHECK (type IN ('tuition')),
  ledger_id   TEXT NOT NULL REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  amount      NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),

  CONSTRAINT invoice_line_position_key UNIQUE (invoice_id, position)
);

ALTER TABLE receipts
  ADD CONSTRAINT receipts_invoice_fkey FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
CREATE TABLE expenses (
  id                    TEXT PRIMARY KEY,
  expense_no            TEXT NOT NULL,
  type                  TEXT CHECK (type IN ('activity', 'wallet_refund')),
  category              TEXT NOT NULL,
  amount                NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  currency              TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND', 'USD')),
  paid_date             DATE NOT NULL,
  payee                 TEXT NOT NULL,
  purpose               TEXT,
  note                  TEXT,
  reason                TEXT,
  student_id            TEXT REFERENCES students (id) ON DELETE RESTRICT,
  class_id              TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  wallet_transaction_id TEXT REFERENCES wallet_transactions (id) ON DELETE RESTRICT,
  status                TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'void')),
  created_by            TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT expenses_no_key UNIQUE (expense_no),
  -- Hoan tien vi thi phai biet hoan cho ai va gan voi giao dich vi nao.
  CONSTRAINT expense_wallet_refund_shape CHECK (
    type IS DISTINCT FROM 'wallet_refund'
    OR (student_id IS NOT NULL AND wallet_transaction_id IS NOT NULL)
  )
);

CREATE INDEX expenses_paid_date_idx ON expenses (paid_date DESC) WHERE status = 'posted';
CREATE INDEX expenses_category_idx  ON expenses (category, paid_date DESC);

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_tx_expense_fkey FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- tuition_configs
-- ---------------------------------------------------------------------------
CREATE TABLE tuition_configs (
  id                     TEXT PRIMARY KEY,
  class_id               TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  teacher_id             TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  default_amount         NUMERIC(14, 2) NOT NULL CHECK (default_amount >= 0),
  currency               TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND', 'USD')),
  due_day_of_month       SMALLINT NOT NULL CHECK (due_day_of_month BETWEEN 1 AND 31),
  auto_generate_monthly  BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tuition_config_class_key UNIQUE (class_id)
);

-- ---------------------------------------------------------------------------
-- payment_requests / webhook_events / payment_order_codes
-- ---------------------------------------------------------------------------
CREATE TABLE payment_requests (
  id                    TEXT PRIMARY KEY,
  order_code            BIGINT NOT NULL,
  provider              TEXT NOT NULL DEFAULT 'payos' CHECK (provider = 'payos'),
  ledger_id             TEXT NOT NULL REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  student_id            TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id              TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  parent_uid            TEXT NOT NULL,
  invoice_id            TEXT REFERENCES invoices (id) ON DELETE RESTRICT,

  amount                NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency              TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  status                TEXT NOT NULL CHECK (status IN (
                          'creating_gateway_session', 'pending', 'paid', 'cancelled', 'expired',
                          'stale', 'failed', 'create_failed', 'needs_review', 'manually_voided')),
  gateway_status        TEXT,
  payment_link_id       TEXT,
  checkout_url          TEXT,
  qr_code               TEXT,
  return_url            TEXT,
  cancel_url            TEXT,
  description           TEXT,

  receipt_id            TEXT REFERENCES receipts (id) ON DELETE RESTRICT,
  review_reason         TEXT,
  review_resolution     TEXT CHECK (review_resolution IN ('approved', 'rejected', 'manual_handling_required')),
  accounting_resolution TEXT CHECK (accounting_resolution IN (
                          'receipt_voided_manual_handling',
                          'manual_receipt_posted_while_gateway_session_active')),
  failure_reason        TEXT,
  stale_reason          TEXT,
  gateway_amount        NUMERIC(14, 2),
  gateway_reference     TEXT,
  gateway_snapshot      JSONB,
  reconciliation_checked_at TIMESTAMPTZ,
  reconciliation_error  TEXT,

  -- Anh chup so tien tai thoi diem tao phien thanh toan: bang chung, khong cache.
  invoice_amount_snapshot   NUMERIC(14, 2),
  invoice_snapshot_version  INTEGER,

  expires_at            TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  voided_at             TIMESTAMPTZ,
  voided_by             TEXT REFERENCES users (id) ON DELETE RESTRICT,
  void_reason           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT payment_requests_order_code_key UNIQUE (order_code)
);

CREATE INDEX payment_requests_ledger_idx ON payment_requests (ledger_id);
CREATE INDEX payment_requests_status_idx ON payment_requests (status, created_at DESC);

ALTER TABLE receipts
  ADD CONSTRAINT receipts_payment_request_fkey
  FOREIGN KEY (payment_request_id) REFERENCES payment_requests (id) ON DELETE RESTRICT;

-- Chong xu ly webhook hai lan bang RANG BUOC thay vi bang kiem tra trong code.
CREATE TABLE webhook_events (
  id                  TEXT PRIMARY KEY,
  provider            TEXT NOT NULL DEFAULT 'payos' CHECK (provider = 'payos'),
  event_hash          TEXT NOT NULL,
  signature_valid     BOOLEAN NOT NULL,
  envelope_code       TEXT,
  envelope_desc       TEXT,
  envelope_success    BOOLEAN,
  order_code          BIGINT,
  amount              NUMERIC(14, 2),
  payment_link_id     TEXT,
  provider_reference  TEXT,
  provider_code       TEXT,
  processing_status   TEXT NOT NULL,
  processing_message  TEXT,
  error               TEXT,
  payment_request_id  TEXT REFERENCES payment_requests (id) ON DELETE RESTRICT,
  receipt_id          TEXT REFERENCES receipts (id) ON DELETE RESTRICT,
  raw_payload         JSONB,
  transaction_datetime TIMESTAMPTZ,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT webhook_events_hash_key UNIQUE (event_hash)
);

CREATE INDEX webhook_events_order_code_idx ON webhook_events (order_code) WHERE order_code IS NOT NULL;

-- Giu cho cap ma don PayOS. Doc ID cu chinh la orderCode.
CREATE TABLE payment_order_codes (
  order_code         BIGINT PRIMARY KEY,
  provider           TEXT NOT NULL DEFAULT 'payos' CHECK (provider = 'payos'),
  status             TEXT NOT NULL CHECK (status IN ('reserved', 'used', 'released')),
  ledger_id          TEXT REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  student_id         TEXT REFERENCES students (id) ON DELETE RESTRICT,
  class_id           TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  parent_uid         TEXT,
  payment_request_id TEXT REFERENCES payment_requests (id) ON DELETE RESTRICT,
  amount             NUMERIC(14, 2) CHECK (amount >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- finance_idempotency_keys
-- ---------------------------------------------------------------------------
-- Collection nay co that tren production (304 doc) nhung tai lieu thiet ke
-- khong nhac. No chan viec ghi tien hai lan khi client retry.
CREATE TABLE finance_idempotency_keys (
  id                  TEXT PRIMARY KEY,        -- '{uid}:{idempotencyKey}'
  uid                 TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  type                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  request_fingerprint TEXT,
  ledger_ids          TEXT[] NOT NULL DEFAULT '{}',
  response            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT finance_idempotency_key_unique UNIQUE (uid, idempotency_key)
);

CREATE INDEX finance_idempotency_created_idx ON finance_idempotency_keys (created_at);

-- ---------------------------------------------------------------------------
-- finance_monthly_aggregates
-- ---------------------------------------------------------------------------
CREATE TABLE finance_monthly_aggregates (
  month           TEXT PRIMARY KEY CHECK (month ~ '^\d{4}-\d{2}$'),
  range_start     DATE NOT NULL,
  range_end       DATE NOT NULL,
  total_income    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_expenses  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  income_by_level JSONB NOT NULL DEFAULT '[]'::jsonb,
  expenses_by_category JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_counts   JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT finance_month_range_order CHECK (range_end >= range_start)
);

-- ---------------------------------------------------------------------------
-- refunds
-- ---------------------------------------------------------------------------
-- Diem mo 4.5: khong co interface trong repo va khong co document nao tren
-- production. Khung toi thieu quanh nhung gi shared/studentRefundEstimate.ts
-- that su can.
CREATE TABLE refunds (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id        TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  ledger_id       TEXT REFERENCES course_fee_ledgers (id) ON DELETE RESTRICT,
  expense_id      TEXT REFERENCES expenses (id) ON DELETE RESTRICT,
  amount          NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND', 'USD')),
  status          TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'paid', 'rejected', 'void')),
  reason          TEXT,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  approved_by     TEXT REFERENCES users (id) ON DELETE RESTRICT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT refund_approval_pair CHECK ((approved_at IS NULL) = (approved_by IS NULL))
);

-- ---------------------------------------------------------------------------
-- tuition_records  — kho luu tru dong bang
-- ---------------------------------------------------------------------------
-- Diem mo 4.2 da chot: khong code nao ghi, khong code nao doc (ngoai
-- fullExportCollections.ts va chinh script da chuyen chung sang ledger).
-- Production hien co 0 document.
--
-- KHONG dat FK du schema nay chu truong rang buoc chat: du lieu legacy co the
-- tro toi hoc sinh da bi xoa tu lau. Gan FK vao se lam fail buoc nap de doi
-- lay gia tri bang khong — bang nay khong con ai ghi nen khong co bat bien nao
-- can bao ve. Khong xoa, vi la lich su tai chinh.
CREATE TABLE tuition_records (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  class_id    TEXT NOT NULL,
  teacher_id  TEXT,
  month       TEXT NOT NULL,
  amount      NUMERIC(14, 2) NOT NULL,
  paid        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status      TEXT NOT NULL,
  due_date    DATE,
  paid_at     TIMESTAMPTZ,
  paid_by     TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ
);

COMMENT ON TABLE tuition_records IS
  'DONG BANG. Khong FK, khong duong ghi, khong trigger. Chi doc de tra cuu lich su. Xem muc 4.2 cua tai lieu thiet ke.';

REVOKE INSERT, UPDATE, DELETE ON tuition_records FROM PUBLIC;

SELECT app_attach_touch('course_fee_ledgers');
SELECT app_attach_touch('student_wallets');
SELECT app_attach_touch('receipts');
SELECT app_attach_touch('wallet_transactions');
SELECT app_attach_touch('invoices');
SELECT app_attach_touch('expenses');
SELECT app_attach_touch('tuition_configs');
SELECT app_attach_touch('payment_requests');
SELECT app_attach_touch('webhook_events');
SELECT app_attach_touch('payment_order_codes');
SELECT app_attach_touch('finance_idempotency_keys');
SELECT app_attach_touch('refunds');

COMMIT;
