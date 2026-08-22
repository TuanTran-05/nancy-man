/** READ-ONLY. Chạy đúng ba lời gọi mà trang Học sinh (admin) phát ra,
 * qua chính handler của server, để xem cái nào tốn thời gian.
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

let ops = 0;
const proxyToTarget = new WeakMap<object, object>();
const unwrap = (v: unknown) =>
  v && typeof v === 'object' && proxyToTarget.has(v as object) ? proxyToTarget.get(v as object) : v;

function wrap<T extends object>(target: T): T {
  const proxy = new Proxy(target, {
    get(t, prop, recv) {
      const value = Reflect.get(t, prop, recv);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(t, args.map(unwrap));
        if (prop === 'get' || prop === 'getAll') {
          ops += 1;
          return result;
        }
        if (result && typeof result === 'object' && typeof (result as any).get === 'function') {
          return wrap(result as object);
        }
        return result;
      };
    },
  }) as T;
  proxyToTarget.set(proxy as unknown as object, target);
  return proxy;
}
const db = wrap(realDb);

const { readStudents, readAccountingStudents, readAssignments } = await import(
  '../server/api/read/handlers/readers.js'
);

const adminUid = 'AUDIT-READONLY';
const ctx = { uid: adminUid, role: 'admin', studentId: null } as never;
const makeReq = (query: Record<string, string>) => ({ query, headers: {}, method: 'GET' }) as never;

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  ops = 0;
  const started = Date.now();
  const result = await run();
  console.log(`${label.padEnd(52)} ${String(Date.now() - started).padStart(6)} ms   ${ops} ops`);
  return result;
}

console.log('\n== A. kênh "students" (danh sách), phân trang 200 như client làm ==');
let cursor = '';
let page = 0;
let total = 0;
const aStart = Date.now();
for (;;) {
  page += 1;
  const query: Record<string, string> = { view: 'directory', limit: '1000' };
  if (cursor) query.cursor = cursor;
  const result: any = await timed(`  students page ${page}`, () =>
    readStudents(db as never, ctx, makeReq(query))
  );
  total += result.students.length;
  if (!result.page?.hasMore) break;
  cursor = String(result.page.nextCursor);
  if (page >= 10) break;
}
console.log(`  => ${total} học sinh qua ${page} lượt gọi, tổng ${Date.now() - aStart} ms`);

console.log('\n== B. kênh "accounting-students" (học phí cho cột Học phí) ==');
await timed('  accounting-students limit=2000', () =>
  readAccountingStudents(db as never, ctx, makeReq({ limit: '2000' }))
);

console.log('\n== C. kênh "assignments" (điểm GPA) ==');
await timed('  assignments limit=2000', () =>
  readAssignments(db as never, ctx, makeReq({ limit: '2000' }))
);

process.exit(0);
