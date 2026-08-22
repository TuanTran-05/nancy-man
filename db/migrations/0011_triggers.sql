-- 0011_triggers.sql
-- Hai bat bien khong dien ta noi bang CHECK mot hang, vi chung noi ve tong
-- cua nhieu hang o nhieu bang.
--
-- Ca hai deu la CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED: chung kiem
-- tra o CUOI transaction, nen mot nghiep vu ghi bien lai + phan bo + giao dich
-- vi theo bat ky thu tu nao cung deu di qua duoc, mien la ket qua cuoi cung
-- can bang.

BEGIN;

-- ---------------------------------------------------------------------------
-- Bat bien 1: bien lai phai can
-- ---------------------------------------------------------------------------
-- Tien mat nhan duoc = phan tra thang vao ledger + phan nap vao vi
--                      - phan rut tu vi de tra ledger.
--
-- Tai lieu thiet ke phat bieu bat bien nay la "SUM(allocations) =
-- amountReceived". Do tren production 2026-08-19 cho thay dieu do SAI: 25/298
-- bien lai khong thoa, va tat ca deu la bien lai co phan tien chay qua vi.
-- Dang day khop 298/298, khong ngoai le.
CREATE OR REPLACE FUNCTION app_assert_receipt_balanced(p_receipt_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount_received NUMERIC(14, 2);
  v_status          TEXT;
  v_allocated       NUMERIC(14, 2);
  v_deposited       NUMERIC(14, 2);
  v_wallet_spent    NUMERIC(14, 2);
BEGIN
  SELECT amount_received, status INTO v_amount_received, v_status
  FROM receipts WHERE id = p_receipt_id;

  -- Bien lai da bi xoa trong cung transaction, hoac chua posted: khong rang buoc.
  IF NOT FOUND OR v_status <> 'posted' THEN
    RETURN;
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_allocated
  FROM receipt_allocations WHERE receipt_id = p_receipt_id;

  SELECT
    coalesce(sum(amount) FILTER (WHERE type = 'deposit'), 0),
    coalesce(sum(amount) FILTER (WHERE type = 'allocation'), 0)
  INTO v_deposited, v_wallet_spent
  FROM wallet_transactions
  WHERE receipt_id = p_receipt_id AND status = 'posted';

  IF v_allocated + v_deposited - v_wallet_spent <> v_amount_received THEN
    RAISE EXCEPTION
      'Bien lai % khong can: phan bo % + nap vi % - rut vi % = %, nhung amount_received = %',
      p_receipt_id, v_allocated, v_deposited, v_wallet_spent,
      v_allocated + v_deposited - v_wallet_spent, v_amount_received
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_trg_receipt_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'receipts' THEN
    v_receipt_id := coalesce(NEW.id, OLD.id);
  ELSE
    v_receipt_id := coalesce(NEW.receipt_id, OLD.receipt_id);
  END IF;

  IF v_receipt_id IS NOT NULL THEN
    PERFORM app_assert_receipt_balanced(v_receipt_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_receipt_balanced
  AFTER INSERT OR UPDATE ON receipts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_trg_receipt_balanced();

CREATE CONSTRAINT TRIGGER trg_receipt_allocation_balanced
  AFTER INSERT OR UPDATE OR DELETE ON receipt_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_trg_receipt_balanced();

CREATE CONSTRAINT TRIGGER trg_wallet_tx_receipt_balanced
  AFTER INSERT OR UPDATE OR DELETE ON wallet_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_trg_receipt_balanced();

-- ---------------------------------------------------------------------------
-- Bat bien 2: status cua ledger phai khop so tien
-- ---------------------------------------------------------------------------
-- 'waived' duoc mien: do la quyet dinh cua con nguoi, khong suy ra tu so tien
-- (chinh vi the status van la cot that chu khong phai view).
-- Do tren production: 739/739 ledger dang khop, 0 vi pham.
CREATE OR REPLACE FUNCTION app_assert_ledger_status(p_ledger_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount   NUMERIC(14, 2);
  v_status   TEXT;
  v_paid     NUMERIC(14, 2);
  v_expected TEXT;
BEGIN
  SELECT amount, status INTO v_amount, v_status
  FROM course_fee_ledgers WHERE id = p_ledger_id;

  IF NOT FOUND OR v_status = 'waived' THEN
    RETURN;
  END IF;

  SELECT coalesce(sum(a.amount), 0) INTO v_paid
  FROM receipt_allocations a
  JOIN receipts r ON r.id = a.receipt_id AND r.status = 'posted'
  WHERE a.ledger_id = p_ledger_id;

  v_expected := CASE
    WHEN v_paid <= 0        THEN 'unpaid'
    WHEN v_paid >= v_amount THEN 'paid'
    ELSE 'partial'
  END;

  IF v_status <> v_expected THEN
    RAISE EXCEPTION
      'Ledger % ghi status=% nhung so tien noi %: da tra % tren tong %',
      p_ledger_id, v_status, v_expected, v_paid, v_amount
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_trg_ledger_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ledger_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'course_fee_ledgers' THEN
    v_ledger_id := coalesce(NEW.id, OLD.id);
  ELSE
    v_ledger_id := coalesce(NEW.ledger_id, OLD.ledger_id);
  END IF;

  IF v_ledger_id IS NOT NULL THEN
    PERFORM app_assert_ledger_status(v_ledger_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_status
  AFTER INSERT OR UPDATE ON course_fee_ledgers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_trg_ledger_status();

CREATE CONSTRAINT TRIGGER trg_ledger_status_from_allocation
  AFTER INSERT OR UPDATE OR DELETE ON receipt_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_trg_ledger_status();

-- ---------------------------------------------------------------------------
-- Tat / bat hai bat bien tren de nap du lieu hang loat
-- ---------------------------------------------------------------------------
-- Chung deferred trong PHAM VI MOT TRANSACTION. Neu buoc nap chia thanh nhieu
-- transaction (ledger truoc, bien lai sau) thi ledger se fail o commit cua
-- chinh no vi bien lai chua ton tai. Hai ham nay la duong thoat co kiem soat:
-- tat, nap, roi bat lai — va ham bat lai TU KIEM TRA TOAN BO, nen khong the
-- quen bat ma van tuong la an toan.
CREATE OR REPLACE FUNCTION app_disable_finance_guards()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  ALTER TABLE receipts            DISABLE TRIGGER trg_receipt_balanced;
  ALTER TABLE receipt_allocations DISABLE TRIGGER trg_receipt_allocation_balanced;
  ALTER TABLE wallet_transactions DISABLE TRIGGER trg_wallet_tx_receipt_balanced;
  ALTER TABLE course_fee_ledgers  DISABLE TRIGGER trg_ledger_status;
  ALTER TABLE receipt_allocations DISABLE TRIGGER trg_ledger_status_from_allocation;
  RAISE NOTICE 'Da tat bat bien tai chinh. PHAI goi app_enable_finance_guards() sau khi nap xong.';
END;
$$;

CREATE OR REPLACE FUNCTION app_enable_finance_guards()
RETURNS TABLE (checked_receipts BIGINT, checked_ledgers BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  n_receipts BIGINT := 0;
  n_ledgers  BIGINT := 0;
BEGIN
  ALTER TABLE receipts            ENABLE TRIGGER trg_receipt_balanced;
  ALTER TABLE receipt_allocations ENABLE TRIGGER trg_receipt_allocation_balanced;
  ALTER TABLE wallet_transactions ENABLE TRIGGER trg_wallet_tx_receipt_balanced;
  ALTER TABLE course_fee_ledgers  ENABLE TRIGGER trg_ledger_status;
  ALTER TABLE receipt_allocations ENABLE TRIGGER trg_ledger_status_from_allocation;

  -- Bat lai khong tu dong kiem tra du lieu da nap trong luc tat, nen kiem o day.
  FOR r IN SELECT id FROM receipts WHERE status = 'posted' LOOP
    PERFORM app_assert_receipt_balanced(r.id);
    n_receipts := n_receipts + 1;
  END LOOP;

  FOR r IN SELECT id FROM course_fee_ledgers LOOP
    PERFORM app_assert_ledger_status(r.id);
    n_ledgers := n_ledgers + 1;
  END LOOP;

  RETURN QUERY SELECT n_receipts, n_ledgers;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tin hieu realtime
-- ---------------------------------------------------------------------------
-- Thay collection realtime_events (20 kenh, moi kenh mot doc co so version
-- tang dan ma client phai poll). LISTEN/NOTIFY day thang toi client dang ket
-- noi, khong ai phai poll.
-- Trigger o muc STATEMENT (khong phai ROW): mot lan ghi hang loat 800 hoc sinh
-- phat mot tin hieu, khong phai 800. Doi lai la khong co targetId — client
-- nhan tin hieu roi tu tai lai phan minh dang xem, dung nhu cach
-- realtime_events dang duoc dung hom nay.
CREATE OR REPLACE FUNCTION app_trg_notify_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM app_notify(TG_ARGV[0], NULL);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_notify_students AFTER INSERT OR UPDATE OR DELETE ON students
  FOR EACH STATEMENT EXECUTE FUNCTION app_trg_notify_change('students');
CREATE TRIGGER trg_notify_classes AFTER INSERT OR UPDATE OR DELETE ON classes
  FOR EACH STATEMENT EXECUTE FUNCTION app_trg_notify_change('classes');
CREATE TRIGGER trg_notify_enrollments AFTER INSERT OR UPDATE OR DELETE ON student_course_enrollments
  FOR EACH STATEMENT EXECUTE FUNCTION app_trg_notify_change('enrollments');
CREATE TRIGGER trg_notify_ledgers AFTER INSERT OR UPDATE OR DELETE ON course_fee_ledgers
  FOR EACH STATEMENT EXECUTE FUNCTION app_trg_notify_change('accounting-student-finance');
CREATE TRIGGER trg_notify_receipts AFTER INSERT OR UPDATE OR DELETE ON receipts
  FOR EACH STATEMENT EXECUTE FUNCTION app_trg_notify_change('finance-receipts');
CREATE TRIGGER trg_notify_attendance AFTER INSERT OR UPDATE OR DELETE ON attendance
  FOR EACH STATEMENT EXECUTE FUNCTION app_trg_notify_change('attendance');

COMMIT;
