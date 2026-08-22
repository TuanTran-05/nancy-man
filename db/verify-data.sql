-- verify-data.sql
-- Chay SAU khi `psql -f db/data.sql` xong:
--
--   psql "$DATABASE_URL" -f db/verify-data.sql
--
-- Doi chieu du lieu tren VPS voi chinh so da do o may dev khi sinh ra data.sql.
-- Cot "ket qua" phai OK het. Mot dong FAIL nghia la thu vao database khac thu
-- da duoc kiem — dung noi ung dung vao, bao lai truoc.
--
-- Cac con so ky vong o duoi lay tu lan sinh data.sql ngay 2026-08-19. Neu sinh
-- lai file tu Firestore vao ngay khac (production van dang chay, so lieu tang),
-- thi so o day phai duoc cap nhat theo — muc `-- ky vong:` o cuoi data.sql la
-- nguon dung.

\pset border 2

\echo ''
\echo '=== 1. So hang cac bang xuong song ==='

WITH got (name, have) AS (VALUES
  ('students',                  (SELECT count(*) FROM students)),
  ('users',                     (SELECT count(*) FROM users)),
  ('classes',                   (SELECT count(*) FROM classes)),
  ('class_terms',               (SELECT count(*) FROM class_terms)),
  ('student_course_enrollments',(SELECT count(*) FROM student_course_enrollments)),
  ('course_fee_ledgers',        (SELECT count(*) FROM course_fee_ledgers)),
  ('receipts',                  (SELECT count(*) FROM receipts)),
  ('receipt_allocations',       (SELECT count(*) FROM receipt_allocations)),
  ('wallet_transactions',       (SELECT count(*) FROM wallet_transactions)),
  ('attendance',                (SELECT count(*) FROM attendance)),
  ('audit_logs',                (SELECT count(*) FROM audit_logs))
),
expected (name, want) AS (VALUES
  ('students',                   750),
  ('users',                      116),
  ('classes',                     54),
  ('class_terms',                 92),
  ('student_course_enrollments',  823),
  ('course_fee_ledgers',          739),
  ('receipts',                    299),
  ('receipt_allocations',         306),
  ('wallet_transactions',         604),
  ('attendance',                 8685),
  ('audit_logs',                 8178)
)
SELECT e.name AS bang, e.want AS ky_vong, g.have AS thuc_te,
       CASE WHEN e.want = g.have THEN 'OK' ELSE 'FAIL' END AS ket_qua
FROM expected e JOIN got g USING (name)
ORDER BY CASE WHEN e.want = g.have THEN 1 ELSE 0 END, e.name;

\echo ''
\echo '=== 2. Tien — phai khop den tung dong ==='

WITH got (name, have) AS (VALUES
  ('tong da thu (ledger)',    (SELECT coalesce(sum(paid_total), 0)::bigint FROM v_ledger_totals)),
  ('tong phan bo bien lai',   (SELECT coalesce(sum(amount), 0)::bigint FROM receipt_allocations)),
  ('tong bien lai ghi so',    (SELECT coalesce(sum(amount_received), 0)::bigint
                                 FROM receipts WHERE status = 'posted')),
  ('tong so du vi',           (SELECT coalesce(sum(balance), 0)::bigint FROM v_student_wallet_balance))
),
expected (name, want) AS (VALUES
  ('tong da thu (ledger)',   372899997::bigint),
  ('tong phan bo bien lai',  372899997::bigint),
  ('tong bien lai ghi so',   382790000::bigint),
  ('tong so du vi',            9890003::bigint)
)
SELECT e.name AS khoan,
       to_char(e.want, 'FM999G999G999') AS ky_vong,
       to_char(g.have, 'FM999G999G999') AS thuc_te,
       CASE WHEN e.want = g.have THEN 'OK' ELSE 'FAIL' END AS ket_qua
FROM expected e JOIN got g USING (name)
ORDER BY CASE WHEN e.want = g.have THEN 1 ELSE 0 END, e.name;

\echo ''
\echo '=== 3. Bat bien — moi so phai bang 0 ==='

WITH probes (muc, n) AS (VALUES
  ('vi am',
   (SELECT count(*) FROM v_student_wallet_balance WHERE balance < 0)),
  ('bo dem lop am',
   (SELECT count(*) FROM v_class_student_counts WHERE active < 0 OR total < 0)),
  ('ledger trung (hoc sinh, lop, ky)',
   (SELECT count(*) FROM (SELECT student_id, class_id, term_start FROM course_fee_ledgers
                          GROUP BY 1, 2, 3 HAVING count(*) > 1) t)),
  ('ma hoc sinh trung',
   (SELECT count(*) FROM (SELECT code_normalized FROM students WHERE code_normalized <> ''
                          GROUP BY 1 HAVING count(*) > 1) t)),
  ('ghi danh tro toi ky khong ton tai',
   (SELECT count(*) FROM student_course_enrollments e
      WHERE NOT EXISTS (SELECT 1 FROM class_terms t
                        WHERE t.class_id = e.class_id AND t.term_start = e.term_start))),
  ('dap an dung khong nam trong phuong an',
   (SELECT count(*) FROM assignment_questions q
      WHERE q.correct_answer IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM assignment_question_options o
        WHERE o.question_id = q.id AND o.option_key = q.correct_answer))),
  ('name_normalized con dau hoac chu thuong',
   (SELECT count(*) FROM students WHERE name_normalized ~ '[^A-Z0-9 ]'))
)
SELECT muc, n AS so_hang, CASE WHEN n = 0 THEN 'OK' ELSE 'FAIL' END AS ket_qua
FROM probes ORDER BY n DESC, muc;

\echo ''
\echo '=== 4. Bat bien tai chinh — quet lai toan bo bien lai va ledger ==='
\echo '    (loi o day se lam ca cau lenh nay that bai, do la y do)'
\echo '    Ham nay ALTER TABLE ... ENABLE TRIGGER, tuc lay khoa doc quyen trong'
\echo '    khoanh khac. Chay ngay sau khi nap, luc chua ung dung nao noi vao.'

SELECT checked_receipts AS bien_lai_da_kiem,
       checked_ledgers  AS ledger_da_kiem
FROM app_enable_finance_guards();

\echo ''
\echo '=== 5. Ham chuan hoa — sai o day la sai vinh vien trong cot sinh ==='

SELECT app_normalize_text('Trần Thị Quỳnh Như') AS ten_1,
       app_normalize_text('Đặng Đình Đô')       AS ten_2,
       app_normalize_code('  hs260847  ')       AS ma,
       CASE WHEN app_normalize_text('Đặng Đình Đô') = 'DANG DINH DO'
            THEN 'OK' ELSE 'FAIL' END           AS ket_qua;
