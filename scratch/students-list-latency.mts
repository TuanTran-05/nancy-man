/** READ-ONLY. Đo xem trang Học sinh tốn thời gian ở đâu.
 *
 * Không ghi gì cả: chỉ đọc control doc, đếm collection, và chạy đúng hàm
 * mà /api/v1/read/students gọi, có đếm số round-trip DocumentStore.
 */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const realDb = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  databaseId
);

// ---------------------------------------------------------------- counters
type Op = { kind: string; ms: number };
let ops: Op[] = [];
const proxyToTarget = new WeakMap<object, object>();

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && proxyToTarget.has(value as object)) {
    return proxyToTarget.get(value as object);
  }
  return value;
}

function wrap<T extends object>(target: T, label: string): T {
  const proxy = new Proxy(target, {
    get(t, prop, recv) {
      const value = Reflect.get(t, prop, recv);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const plain = args.map(unwrap);
        const isRead = prop === 'get' || prop === 'getAll';
        const started = Date.now();
        const result = (value as (...a: unknown[]) => unknown).apply(t, plain);
        if (isRead) {
          const kind = `${label}.${String(prop)}`;
          return Promise.resolve(result).then((settled) => {
            ops.push({ kind, ms: Date.now() - started });
            return settled;
          });
        }
        if (result && typeof result === 'object' && typeof (result as any).get === 'function') {
          const nextLabel =
            prop === 'collection' || prop === 'doc' ? String(args[0] ?? label) : label;
          return wrap(result as object, nextLabel);
        }
        return result;
      };
    },
  }) as T;
  proxyToTarget.set(proxy as unknown as object, target);
  return proxy;
}

const db = wrap(realDb, 'db');

function reportOps(title: string, wallMs: number) {
  const byKind = new Map<string, { count: number; ms: number }>();
  for (const op of ops) {
    const entry = byKind.get(op.kind) || { count: 0, ms: 0 };
    entry.count += 1;
    entry.ms += op.ms;
    byKind.set(op.kind, entry);
  }
  const total = ops.length;
  const totalMs = ops.reduce((sum, op) => sum + op.ms, 0);
  console.log(`\n--- ${title}`);
  console.log(`  wall clock        : ${wallMs} ms`);
  console.log(`  documentStore ops     : ${total} (tổng ${totalMs} ms trong hàng đợi)`);
  for (const [kind, entry] of [...byKind.entries()].sort((a, b) => b[1].ms - a[1].ms)) {
    console.log(`    ${kind.padEnd(38)} x${String(entry.count).padStart(4)}  ${entry.ms} ms`);
  }
  ops = [];
}

// ---------------------------------------------------------------- baseline
{
  const started = Date.now();
  for (let i = 0; i < 5; i += 1) {
    await realDb.collection('_maintenance').doc('student_identity_read_model').get();
  }
  console.log(`RTT một doc.get() từ máy này: ~${Math.round((Date.now() - started) / 5)} ms`);
}

// ---------------------------------------------------------------- mode
const { readCanonicalStudentReadControl } = await import(
  '../server/api/lib/student/canonicalStudentReadControl.js'
);
const control = await readCanonicalStudentReadControl(realDb as never);
console.log(`\nchế độ đọc học sinh: ${control.mode} (generation ${control.generation})`);

// ---------------------------------------------------------------- sizes
const [studentsSnap, aliasSnap, enrollSnap, classSnap] = await Promise.all([
  realDb.collection('students').select('name').get(),
  realDb.collection('student_profile_aliases').select().get(),
  realDb.collection('student_course_enrollments').select('studentId').get(),
  realDb.collection('classes').select().get(),
]);
console.log(
  `students=${studentsSnap.size}  aliases=${aliasSnap.size}  enrollments=${enrollSnap.size}  classes=${classSnap.size}`
);

// ---------------------------------------------------------------- canonical
const { listCanonicalStudentDirectory } = await import(
  '../server/api/lib/student/canonicalStudentReadRepository.js'
);

let cursor: string | undefined;
let pageNumber = 0;
let rowTotal = 0;
const overallStart = Date.now();
for (;;) {
  pageNumber += 1;
  const started = Date.now();
  const page = await listCanonicalStudentDirectory(db as never, { limit: 200, cursor });
  const wall = Date.now() - started;
  rowTotal += page.rows.length;
  reportOps(
    `canonical directory page ${pageNumber} (${page.rows.length} rows, anomalies ${page.anomalies.length})`,
    wall
  );
  if (!page.nextCursor) break;
  cursor = page.nextCursor;
  if (pageNumber >= 10) break;
}
console.log(
  `\n=> canonical: ${rowTotal} rows qua ${pageNumber} trang, tổng ${Date.now() - overallStart} ms`
);

// ---------------------------------------------------------------- legacy
const legacyStart = Date.now();
const legacySnap = await realDb.collection('students').orderBy('name').limit(200).get();
console.log(
  `\nlegacy query (students orderBy name limit 200): ${Date.now() - legacyStart} ms, ${legacySnap.size} docs`
);

const { readCanonicalStudentsByIds } = await import(
  '../server/api/lib/student/canonicalStudentReadRepository.js'
);
ops = [];
const compareStart = Date.now();
const compared = await readCanonicalStudentsByIds(
  db as never,
  legacySnap.docs.map((doc) => doc.id)
);
reportOps(
  `shadow compare readCanonicalStudentsByIds(${legacySnap.size} ids) -> ${compared.size} rows`,
  Date.now() - compareStart
);

process.exit(0);
