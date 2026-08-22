-- 0010_views.sql
-- Truong dan xuat: khong luu thanh cot, dung VIEW / MATERIALIZED VIEW.
--
-- Ly do cu the, khong phai nguyen tac chung: tren Firestore ba con so tong
-- (paidTotal, discountTotal, walletBalance) chay song song voi chung tu ma
-- khong gi buoc phai khop. Do la co che sinh lech so du. Con
-- Class.studentCounts thi da lech that — do tren production 2026-08-19:
-- studentCounts.active co gia tri AM toi -16, onLeave toi -3. Mot bo dem
-- khong the am; no am vi duoc cong tru bang tay qua nhieu duong ghi.

BEGIN;

-- ---------------------------------------------------------------------------
-- v_class_current_term
-- ---------------------------------------------------------------------------
-- Sau khi tach class_terms, "ky hien tai" khong con la mot nhom cot tren
-- classes nua — no la hang co term_start lon nhat. View nay la mot cho duy
-- nhat de dinh nghia dieu do.
CREATE VIEW v_class_current_term AS
SELECT DISTINCT ON (t.class_id)
  t.class_id,
  t.id            AS term_id,
  t.course_id,
  t.name          AS term_name,
  t.term_start,
  t.term_end,
  t.tuition_fee,
  t.currency,
  t.start_time,
  t.days_of_week,
  (t.term_end IS NULL OR t.term_end >= CURRENT_DATE) AS is_open
FROM class_terms t
ORDER BY t.class_id, t.term_start DESC;

COMMENT ON VIEW v_class_current_term IS
  'Thay cac cot startDate/endDate/startTime/daysOfWeek/tuitionFee/currentCourseId tung nam tren classes.';

-- ---------------------------------------------------------------------------
-- v_class_student_counts
-- ---------------------------------------------------------------------------
-- Thay Class.studentCounts{}. Ten cot giu nguyen hop dong voi client
-- (total/active/trial/on_leave/dropped/promoted).
CREATE VIEW v_class_term_student_counts AS
SELECT
  e.class_id,
  e.term_start,
  count(*)                                                    AS total,
  count(*) FILTER (WHERE e.status = 'active')                 AS active,
  count(*) FILTER (WHERE e.status = 'trial')                  AS trial,
  count(*) FILTER (WHERE e.status = 'on_leave')               AS on_leave,
  count(*) FILTER (WHERE e.status = 'dropped')                AS dropped,
  count(*) FILTER (WHERE e.status = 'completed')              AS completed,
  -- 'promoted' cua UI cu chinh la enrollment ket thuc vi chuyen len lop khac.
  count(*) FILTER (WHERE e.status = 'transferred')            AS promoted
FROM student_course_enrollments e
GROUP BY e.class_id, e.term_start;

CREATE VIEW v_class_student_counts AS
SELECT
  c.id AS class_id,
  coalesce(n.total, 0)     AS total,
  coalesce(n.active, 0)    AS active,
  coalesce(n.trial, 0)     AS trial,
  coalesce(n.on_leave, 0)  AS on_leave,
  coalesce(n.dropped, 0)   AS dropped,
  coalesce(n.completed, 0) AS completed,
  coalesce(n.promoted, 0)  AS promoted
FROM classes c
LEFT JOIN v_class_current_term ct ON ct.class_id = c.id
LEFT JOIN v_class_term_student_counts n
       ON n.class_id = c.id AND n.term_start = ct.term_start;

COMMENT ON VIEW v_class_student_counts IS
  'Khong the am. Bo dem cu tren Firestore am toi -16 vi duoc cong tru bang tay tu nhieu duong ghi khac nhau.';

-- ---------------------------------------------------------------------------
-- v_ledger_totals
-- ---------------------------------------------------------------------------
-- Thay CourseFeeLedger.paidTotal / discountTotal / siblingDiscountTotal.
-- Chi tinh tu bien lai da posted — bien lai draft hoac void khong phai tien.
CREATE VIEW v_ledger_totals AS
SELECT
  l.id AS ledger_id,
  coalesce(sum(a.amount), 0)                  AS paid_total,
  coalesce(sum(a.discount_amount), 0)         AS discount_total,
  coalesce(sum(a.sibling_discount_amount), 0) AS sibling_discount_total,
  l.amount
    - coalesce(sum(a.amount), 0)
    - coalesce(sum(a.discount_amount), 0)     AS outstanding,
  count(a.id)                                 AS allocation_count
FROM course_fee_ledgers l
LEFT JOIN receipt_allocations a ON a.ledger_id = l.id
LEFT JOIN receipts r            ON r.id = a.receipt_id AND r.status = 'posted'
WHERE a.id IS NULL OR r.id IS NOT NULL
GROUP BY l.id, l.amount;

COMMENT ON VIEW v_ledger_totals IS
  'Do doi chieu 2026-08-19: view nay tra ra dung bang cot paidTotal cu tren ca 739/739 ledger, tong lech 0 dong.';

-- ---------------------------------------------------------------------------
-- v_student_wallet_balance
-- ---------------------------------------------------------------------------
-- Khai trien dung computeWalletBalanceFromOpening() trong shared/wallet.ts.
-- Tra ve SO HOC THAT, ke ca khi am — dung chu y da ghi trong file do: so du am
-- phai lo ra de doi chieu bat duoc, chu khong bi Math.max(0, ...) che di.
CREATE VIEW v_student_wallet_balance AS
SELECT
  s.id AS student_id,
  coalesce(w.opening_balance, 0)
    + coalesce(sum(
        CASE t.type
          WHEN 'deposit'    THEN  t.amount
          WHEN 'credit'     THEN  t.amount
          WHEN 'allocation' THEN -t.amount
          WHEN 'refund'     THEN -t.amount
          WHEN 'adjustment' THEN CASE WHEN t.direction = 'out' THEN -t.amount ELSE t.amount END
        END), 0) AS balance,
  coalesce(w.opening_balance, 0) AS opening_balance,
  w.history_started_at,
  count(t.id) AS posted_transaction_count
FROM students s
LEFT JOIN student_wallets w ON w.student_id = s.id
LEFT JOIN wallet_transactions t
       ON t.student_id = s.id AND t.status = 'posted'
GROUP BY s.id, w.opening_balance, w.history_started_at;

COMMENT ON VIEW v_student_wallet_balance IS
  'Do doi chieu 2026-08-19: khop 330/331 hoc sinh co walletBalance luu san; 1 hang lech (b9C4QhZ1h7qQEFp8ChId: luu 200000, tinh lai 0) — phai lam ro truoc khi nap.';

-- ---------------------------------------------------------------------------
-- v_student_current_enrollment
-- ---------------------------------------------------------------------------
-- Thay hai cot students.classId / students.teacherId. Mot hoc sinh co the hoc
-- nhieu lop; mot cot classId chua bao gio dien ta noi dieu do.
CREATE VIEW v_student_current_enrollment AS
SELECT
  e.student_id,
  e.id         AS enrollment_id,
  e.class_id,
  c.teacher_id,
  e.term_start,
  e.term_end,
  e.status,
  e.joined_at
FROM student_course_enrollments e
JOIN classes c ON c.id = e.class_id
WHERE e.status IN ('trial', 'active', 'on_leave');

-- ---------------------------------------------------------------------------
-- mv_accounting_student_summary
-- ---------------------------------------------------------------------------
-- Thay collection accounting_student_summaries (744 doc) VA bo may outbox +
-- health theo doi no. Materialized view co transaction: khong con trang thai
-- "lech" de theo doi.
CREATE MATERIALIZED VIEW mv_accounting_student_summary AS
SELECT
  s.id                       AS student_id,
  s.code                     AS student_code,
  s.name                     AS student_name,
  s.name_normalized          AS student_name_normalized,
  s.student_lifecycle,
  cur.class_id               AS current_class_id,
  cur.enrollment_id          AS current_enrollment_id,
  cur.status                 AS current_enrollment_status,
  coalesce(agg.class_count, 0)          AS class_count,
  coalesce(agg.course_count, 0)         AS course_count,
  coalesce(agg.total_paid, 0)           AS total_paid,
  coalesce(agg.total_outstanding, 0)    AS total_outstanding,
  coalesce(agg.overdue_course_count, 0) AS overdue_course_count,
  coalesce(wb.balance, 0)               AS wallet_balance,
  coalesce(nl.reminder_count, 0)        AS tuition_reminder_count,
  nl.last_reminder_at,
  now()                                 AS rebuilt_at
FROM students s
LEFT JOIN LATERAL (
  SELECT e.class_id, e.id AS enrollment_id, e.status
  FROM student_course_enrollments e
  WHERE e.student_id = s.id AND e.status IN ('trial', 'active', 'on_leave')
  ORDER BY e.term_start DESC
  LIMIT 1
) cur ON true
LEFT JOIN LATERAL (
  SELECT
    count(DISTINCT l.class_id)                             AS class_count,
    count(*)                                               AS course_count,
    sum(vt.paid_total)                                     AS total_paid,
    sum(GREATEST(vt.outstanding, 0))                       AS total_outstanding,
    count(*) FILTER (
      WHERE l.status IN ('unpaid', 'partial')
        AND l.due_date IS NOT NULL
        AND l.due_date < CURRENT_DATE
    )                                                      AS overdue_course_count
  FROM course_fee_ledgers l
  JOIN v_ledger_totals vt ON vt.ledger_id = l.id
  WHERE l.student_id = s.id
) agg ON true
LEFT JOIN v_student_wallet_balance wb ON wb.student_id = s.id
LEFT JOIN LATERAL (
  SELECT count(*) AS reminder_count, max(n.sent_at) AS last_reminder_at
  FROM ledger_notice_log n
  JOIN course_fee_ledgers l2 ON l2.id = n.ledger_id
  WHERE l2.student_id = s.id
) nl ON true;

-- UNIQUE index bat buoc de REFRESH ... CONCURRENTLY chay duoc (khong khoa doc).
CREATE UNIQUE INDEX mv_accounting_student_summary_pk
  ON mv_accounting_student_summary (student_id);
CREATE INDEX mv_accounting_summary_name_trgm
  ON mv_accounting_student_summary USING gin (student_name_normalized gin_trgm_ops);
CREATE INDEX mv_accounting_summary_outstanding
  ON mv_accounting_student_summary (total_outstanding DESC)
  WHERE total_outstanding > 0;

-- ---------------------------------------------------------------------------
-- mv_admin_class_tuition_summary
-- ---------------------------------------------------------------------------
-- Thay admin_class_tuition_summaries (doc ID cu la '{classId}__{termStart}' —
-- mot ID mang ngu nghia nua). Gio khoa la cap cot that.
CREATE MATERIALIZED VIEW mv_admin_class_tuition_summary AS
SELECT
  l.class_id,
  l.term_start,
  count(*)                                     AS ledger_count,
  sum(l.amount)                                AS total_amount,
  sum(vt.paid_total)                           AS total_paid,
  sum(vt.discount_total)                       AS total_discount,
  sum(GREATEST(vt.outstanding, 0))             AS total_outstanding,
  count(*) FILTER (WHERE l.status = 'paid')    AS paid_count,
  count(*) FILTER (WHERE l.status = 'partial') AS partial_count,
  count(*) FILTER (WHERE l.status = 'unpaid')  AS unpaid_count,
  count(*) FILTER (WHERE l.status = 'waived')  AS waived_count,
  now()                                        AS rebuilt_at
FROM course_fee_ledgers l
JOIN v_ledger_totals vt ON vt.ledger_id = l.id
WHERE l.term_start IS NOT NULL
GROUP BY l.class_id, l.term_start;

CREATE UNIQUE INDEX mv_admin_class_tuition_summary_pk
  ON mv_admin_class_tuition_summary (class_id, term_start);

-- ---------------------------------------------------------------------------
-- Lam moi hai materialized view
-- ---------------------------------------------------------------------------
-- Goi sau moi lan ghi tien va theo lich (crontab), thay cho co che
-- outbox + health hien tai.
CREATE OR REPLACE FUNCTION app_refresh_finance_summaries()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_accounting_student_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_admin_class_tuition_summary;
  PERFORM app_notify('accounting-student-finance');
  PERFORM app_notify('admin-class-tuition');
END;
$$;

COMMENT ON FUNCTION app_refresh_finance_summaries() IS
  'REFRESH CONCURRENTLY nen trang danh sach van doc duoc trong luc lam moi. Thay accounting_student_summary_health va admin_class_tuition_health — cache co transaction thi khong co trang thai lech de theo doi.';

COMMIT;
