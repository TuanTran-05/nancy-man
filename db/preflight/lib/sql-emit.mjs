// Ghi lai moi cau lenh GHI da chay THANH CONG tren PGlite, tuan tu, roi xuat ra
// mot file .sql chay duoc bang `psql -f`.
//
// Vi sao lam kieu nay thay vi noi thang toi Postgres tren VPS:
//   - khong phai mo cong 5432 ra ngoai, khong phai dung SSH tunnel;
//   - file duoc sinh ra TU mot lan nap that su da thanh cong tren mot Postgres
//     that (PGlite cung nhan), nen no khong phai "SQL doan mo";
//   - 05-verify-dump.mjs phat lai chinh file do vao mot Postgres trong sach roi
//     doi chieu lai tien — tuc thu ban cam len VPS la thu da duoc kiem.
//
// Chi ghi cau lenh GHI. Cac SELECT doc nguoc (loader dung de biet hang nao da
// vao) khong co mat trong file. BEGIN/COMMIT long ben trong cung bi bo: ca file
// nam trong DUNG MOT transaction, nen cac rang buoc DEFERRABLE duoc kiem mot lan
// o cuoi — dung y do thiet ke.

const WRITE = /^\s*(INSERT|UPDATE|DELETE)\b/i;
const TXN = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|START\s+TRANSACTION)\b/i;
const GUARD = /app_(disable|enable)_finance_guards/i;

const BACKSLASH = String.fromCharCode(92);
const NUL = String.fromCharCode(0);

// Chuoi -> literal SQL. standard_conforming_strings duoc bat o dau file nen dau
// gach cheo nguoc la ky tu thuong; chi con dau nhay don phai nhan doi.
function quote(s) {
  if (s.includes(NUL)) {
    throw new Error('chuoi chua NUL byte, Postgres khong luu duoc: ' + JSON.stringify(s.slice(0, 40)));
  }
  return `'${s.split("'").join("''")}'`;
}

// Mang JS -> literal mang Postgres ('{"a","b"}'), dung dang ma driver van gui.
// De Postgres tu ep sang kieu cot dich (TEXT[], SMALLINT[]...) thay vi doan o day.
function arrayLiteral(arr) {
  const parts = arr.map((e) => {
    if (e === null || e === undefined) return 'NULL';
    const esc = String(e)
      .split(BACKSLASH).join(BACKSLASH + BACKSLASH)
      .split('"').join(BACKSLASH + '"');
    return `"${esc}"`;
  });
  return quote(`{${parts.join(',')}}`);
}

export function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`so khong huu han: ${v}`);
    return String(v);
  }
  if (typeof v === 'bigint') return String(v);
  if (v instanceof Date) return quote(v.toISOString());
  if (Array.isArray(v)) return arrayLiteral(v);
  if (typeof v === 'string') return quote(v);
  throw new Error(`khong biet cach viet gia tri kieu ${typeof v} ra SQL: ${JSON.stringify(v).slice(0, 60)}`);
}

// Thay $1,$2... bang literal. Cac cau lenh cua loader deu la INSERT/UPDATE sinh
// may nen khong co $n nam trong chuoi; neu co, so tham so dem duoc se lech va
// ham nay bao loi thay vi im lang sinh ra SQL sai.
function inline(sql, params) {
  if (!params || params.length === 0) return sql;
  const used = new Set();
  const out = sql.replace(/\$(\d+)/g, (_, n) => {
    const i = Number(n) - 1;
    if (i < 0 || i >= params.length) throw new Error(`$${n} vuot ngoai ${params.length} tham so`);
    used.add(i);
    return literal(params[i]);
  });
  if (used.size !== params.length) {
    throw new Error(`cau lenh dung ${used.size}/${params.length} tham so: ${sql.slice(0, 80)}`);
  }
  return out;
}

export function createRecorder() {
  const lines = [];
  let statements = 0;
  return {
    get count() { return statements; },
    // Chi goi SAU khi cau lenh da chay thanh cong tren PGlite.
    record(sql, params) {
      if (TXN.test(sql)) return;
      // Loi goi guard khong ghi lai o day: render() da dat chung dung cho o dau
      // va cuoi file. Ghi lai nua thanh tat/bat hai lan.
      if (GUARD.test(sql)) return;
      if (!WRITE.test(sql)) return;
      lines.push(inline(sql, params) + ';');
      statements++;
    },
    section(title) {
      lines.push('');
      lines.push(`-- ${'-'.repeat(72)}`);
      lines.push(`-- ${title}`);
    },
    render({ sourceDatabase, generatedAt, counts }) {
      const head = [
        '-- edutrack — du lieu production do vao schema PostgreSQL.',
        '--',
        `-- Sinh luc:      ${generatedAt}`,
        `-- Nguon:         Firestore ${sourceDatabase}`,
        `-- So cau lenh:   ${statements}`,
        '--',
        '-- File nay duoc sinh ra tu mot lan nap DA THANH CONG tren mot Postgres that,',
        '-- va da duoc phat lai + doi chieu tien boi db/preflight/05-verify-dump.mjs.',
        '--',
        '-- Chay:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/data.sql',
        '--',
        '-- Toan bo nam trong MOT transaction: hoac vao het, hoac khong hang nao vao.',
        '',
        "SET client_encoding = 'UTF8';",
        'SET standard_conforming_strings = on;',
        '',
        'BEGIN;',
        '',
        '-- Chan nap hai lan. Nap chong len du lieu cu se de lai hai the he lan nhau,',
        '-- kho go hon nhieu so voi viec dung lai o day.',
        'DO $preflight$',
        'BEGIN',
        '  IF EXISTS (SELECT 1 FROM students) THEN',
        "    RAISE EXCEPTION 'Bang students da co du lieu — dung nap chong len. Xem db/DEPLOY.md muc \"Nap lai tu dau\".';",
        '  END IF;',
        'END',
        '$preflight$;',
        '',
        '-- Bat bien tai chinh la CONSTRAINT TRIGGER kiem chung tu doi ung. Trong luc',
        '-- nap, mot ben luon toi truoc ben kia, nen phai tat — va bat lai o cuoi thi',
        '-- ham tu kiem tra TOAN BO, khong the quen bat ma van tuong la an toan.',
        'SELECT app_disable_finance_guards();',
      ];
      const tail = [
        '',
        `-- ${'-'.repeat(72)}`,
        '-- Chot lai',
        '',
        '-- Ep kiem ngay cac rang buoc DEFERRABLE, de neu hong thi hong o day —',
        '-- co thong bao ro rang — chu khong hong lang le o COMMIT.',
        'SET CONSTRAINTS ALL IMMEDIATE;',
        '',
        '-- Bat lai bat bien tai chinh. Ham nay quet lai moi bien lai da ghi so va moi',
        '-- ledger; mot hang lech thoi la ca transaction nay bi huy.',
        'SELECT * FROM app_enable_finance_guards();',
        '',
        ...Object.entries(counts ?? {}).map(([t, n]) => `-- ky vong: ${t} = ${n}`),
        '',
        'COMMIT;',
        '',
      ];
      return [...head, ...lines, ...tail].join('\n') + '\n';
    },
  };
}

// Boc PGlite lai: van chay that, nhung moi cau lenh ghi thanh cong deu duoc ghi
// vao recorder. Chu y thu tu — record() nam SAU await, nen hang bi tu choi
// khong lot vao file.
export function withRecorder(pg, recorder) {
  if (!recorder) return pg;
  return {
    query: async (sql, params) => {
      const r = await pg.query(sql, params);
      recorder.record(sql, params);
      return r;
    },
    exec: async (sql) => {
      const r = await pg.exec(sql);
      recorder.record(sql, null);
      return r;
    },
  };
}
