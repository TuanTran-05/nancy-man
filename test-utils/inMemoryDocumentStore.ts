/**
 * A small stateful DocumentStore fake.
 *
 * The reason it is stateful rather than a snapshot stub: the properties worth
 * testing in this codebase are mostly about what happens on the *second* run.
 * Whether promoting a cohort twice creates a second profile, whether a retried
 * transfer opens a second enrollment, whether a rebuild is idempotent — none of
 * those can be observed against a stub that replays the same seed for every
 * call. Writes here land in the store, so the next read sees them.
 *
 * It is deliberately not a DocumentStore emulator. Query support is limited to the
 * operators this codebase actually uses (`==`, `in`, `>=`, `<`), and
 * transactions stage writes and apply them at commit without contention.
 * Anything needing real transaction semantics — retries, contention,
 * serialization — belongs in the emulator suite
 * (`npm run test:student-progression-emulator`), not here.
 *
 * `orderBy`, `startAfter`, and `limit` are honored rather than ignored, because
 * a fake that ignores them lets a pagination test pass without paginating
 * anything: every page would return the whole collection and still look
 * correct. One DocumentStore behavior is reproduced deliberately — ordering by a
 * field excludes documents that do not have it — since that silently drops
 * rows in production and is invisible to a fake that ignores ordering.
 */

export type DocumentStoreDocumentData = Record<string, unknown>;

type DocumentStoreField = string | { segments?: unknown };

export type QueryFilter = [field: DocumentStoreField, op: string, value: unknown];

export type InMemoryDocumentStore = {
  /** Path -> document data. Mutating it directly is a legitimate way to seed. */
  store: Map<string, DocumentStoreDocumentData>;
  /** Paths written, in commit order, including repeats. */
  writeLog: string[];
  /**
   * Reads in order, including repeats: `students/x` for document gets,
   * `query:students` for collection gets. Repeats are the point — reading one
   * class document once per roster row is invisible in a result assertion and
   * obvious here.
   */
  readLog: string[];
  /**
   * The shape of each query performed, in order.
   *
   * `readLog` says a collection was queried; this says how. A full scan and a
   * bounded page both return the right rows, so "this endpoint pages instead
   * of reading the collection whole" is only checkable if the limit, the
   * cursor, and the filters survive into the test.
   */
  queryLog: Array<{
    collection: string;
    filters: QueryFilter[];
    order?: string;
    after?: unknown;
    take?: number;
    fields?: string[];
  }>;
  db: never;
};

/** DocumentStore's sentinel for ordering by document id. */
export const DOCUMENT_ID_FIELD = '__name__';

/**
 * Applies a merge the way DocumentStore does, including the delete sentinel.
 *
 * `FieldValue.delete()` arrives as an opaque object. A fake that merged it in
 * would leave the sentinel sitting in the document, so a test asserting the
 * field is gone would fail against code that is correct — or, worse, one
 * asserting it is present would pass.
 */
function mergeInto(
  existing: DocumentStoreDocumentData,
  patch: DocumentStoreDocumentData
): DocumentStoreDocumentData {
  const next: DocumentStoreDocumentData = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (isDeleteSentinel(value)) delete next[key];
    else next[key] = value;
  }
  return next;
}

function isDeleteSentinel(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const name = value.constructor?.name || '';
  return (
    name === 'DeleteTransform' ||
    (value as { methodName?: string }).methodName === 'delete' ||
    (value as { kind?: string }).kind === 'delete'
  );
}

function fieldSegments(field: DocumentStoreField): string[] {
  if (typeof field === 'string') return field.split('.').filter(Boolean);
  return Array.isArray(field.segments)
    ? field.segments.filter((segment): segment is string => typeof segment === 'string')
    : [];
}

function fieldName(field: DocumentStoreField): string {
  return fieldSegments(field).join('.');
}

function fieldValue(
  data: DocumentStoreDocumentData,
  field: DocumentStoreField,
  documentId: string
): unknown {
  const segments = fieldSegments(field);
  if (segments.length === 1 && segments[0] === DOCUMENT_ID_FIELD) return documentId;
  let value: unknown = data;
  for (const segment of segments) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

function compare(left: unknown, right: unknown): number {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

function matchesFilter(
  data: DocumentStoreDocumentData,
  documentId: string,
  [field, op, expected]: QueryFilter
): boolean {
  const actual = fieldValue(data, field, documentId);
  const comparison = compare(actual, expected);
  if (op === '==') return equal(actual, expected);
  if (op === '!=') return !equal(actual, expected);
  if (op === '<') return comparison < 0;
  if (op === '<=') return comparison <= 0;
  if (op === '>') return comparison > 0;
  if (op === '>=') return comparison >= 0;
  if (op === 'in') return Array.isArray(expected) && expected.some((value) => equal(actual, value));
  if (op === 'not-in') {
    return Array.isArray(expected) && !expected.some((value) => equal(actual, value));
  }
  if (op === 'array-contains') {
    return Array.isArray(actual) && actual.some((value) => equal(value, expected));
  }
  if (op === 'array-contains-any') {
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.some((value) => expected.some((candidate) => equal(value, candidate)))
    );
  }
  return false;
}

export function createInMemoryDocumentStore(
  seed: Record<string, DocumentStoreDocumentData> = {}
): InMemoryDocumentStore {
  const store = new Map<string, DocumentStoreDocumentData>(
    Object.entries(seed).map(([path, data]) => [path, { ...data }])
  );
  const writeLog: string[] = [];
  const readLog: string[] = [];
  const queryLog: InMemoryDocumentStore['queryLog'] = [];
  let autoId = 0;

  function docRef(path: string) {
    const id = path.slice(path.lastIndexOf('/') + 1);
    const ref = {
      path,
      id,
      get: async () => {
        readLog.push(path);
        return {
          id,
          exists: store.has(path),
          ref,
          updateTime: { toDate: () => new Date(0) },
          data: () => store.get(path),
        };
      },
      set: async (data: DocumentStoreDocumentData, options?: { merge?: boolean }) => {
        writeLog.push(path);
        store.set(path, options?.merge ? mergeInto(store.get(path) ?? {}, data) : { ...data });
      },
      update: async (data: DocumentStoreDocumentData) => {
        writeLog.push(path);
        store.set(path, mergeInto(store.get(path) ?? {}, data));
      },
      delete: async () => {
        writeLog.push(path);
        store.delete(path);
      },
      // Subcollections directly beneath this document. Recursive discovery
      // walks the database this way, and a reference hiding one level down is
      // exactly the kind this fake must not conceal.
      listCollections: async () => listCollectionsUnder(path),
    };
    return ref;
  }

  /**
   * Collection paths one level below `prefix`, or the roots when it is empty.
   *
   * Derived from the stored paths rather than tracked separately, so a
   * document seeded into a collection nobody declared is still discoverable —
   * which is the whole point of a recursive scan.
   */
  function listCollectionsUnder(prefix: string) {
    const depth = prefix === '' ? 0 : prefix.split('/').length;
    const names = new Set<string>();
    for (const documentPath of store.keys()) {
      if (prefix !== '' && !documentPath.startsWith(`${prefix}/`)) continue;
      const segments = documentPath.split('/');
      // A document lives at an odd number of segments below its collection, so
      // a collection under `prefix` sits at `depth` and needs a document id
      // after it to exist at all.
      if (segments.length < depth + 2) continue;
      names.add(segments[depth]);
    }
    return [...names].sort().map((name) => {
      const collectionPath = prefix === '' ? name : `${prefix}/${name}`;
      return {
        id: name,
        path: collectionPath,
        get: async () => {
          readLog.push(`query:${collectionPath}`);
          const docs = [...store.entries()]
            .filter(([documentPath]) => {
              const segments = documentPath.split('/');
              return (
                documentPath.startsWith(`${collectionPath}/`) &&
                segments.length === collectionPath.split('/').length + 1
              );
            })
            .map(([documentPath, data]) => ({
              id: documentPath.slice(documentPath.lastIndexOf('/') + 1),
              exists: true,
              ref: docRef(documentPath),
              updateTime: { toDate: () => new Date(0) },
              data: () => data,
            }));
          return {
            empty: docs.length === 0,
            size: docs.length,
            docs,
            forEach: (callback: (doc: (typeof docs)[number]) => void) => docs.forEach(callback),
          };
        },
      };
    });
  }

  function query(
    collection: string,
    filters: QueryFilter[] = [],
    shape: {
      order?: string;
      direction?: 'asc' | 'desc';
      after?: unknown;
      take?: number;
      takeLast?: number;
      fields?: string[];
    } = {}
  ) {
    const self: Record<string, unknown> = {};
    const keyOf = (id: string, data: DocumentStoreDocumentData) =>
      shape.order === undefined ? id : fieldValue(data, shape.order, id);

    Object.assign(self, {
      __collection: collection,
      __filters: filters,
      where: (field: DocumentStoreField, op: string, value: unknown) =>
        query(collection, [...filters, [field, op, value]], shape),
      orderBy: (field: DocumentStoreField, direction: 'asc' | 'desc' = 'asc') =>
        query(collection, filters, { ...shape, order: fieldName(field), direction }),
      startAfter: (value: unknown) => {
        const cursor =
          typeof value === 'object' && value !== null && 'id' in value
            ? (value as { id: unknown }).id
            : value;
        return query(collection, filters, { ...shape, after: cursor });
      },
      limit: (take: number) => query(collection, filters, { ...shape, take }),
      select: (...fields: string[]) => query(collection, filters, { ...shape, fields }),
      // DocumentStore returns the last n of the ordered set, still in ascending
      // order — not a reversed page.
      limitToLast: (takeLast: number) => query(collection, filters, { ...shape, takeLast }),
      get: async () => {
        readLog.push(`query:${collection}`);
        // Copied, not referenced: `where` builds a new query off this filter
        // array, and a shared reference would let a later refinement rewrite
        // the record of an earlier read.
        const queryEntry: InMemoryDocumentStore['queryLog'][number] = {
          collection,
          filters: filters.map(([field, op, value]) => [fieldName(field), op, value]),
          order: shape.order,
          after: shape.after,
          take: shape.take,
        };
        if (shape.fields) queryEntry.fields = [...shape.fields];
        queryLog.push(queryEntry);
        let rows = [...store.entries()]
          .filter(([path]) => {
            if (!path.startsWith(`${collection}/`)) return false;
            return path.split('/').length === collection.split('/').length + 1;
          })
          .map(([path, data]) => ({ id: path.slice(collection.length + 1), path, data }))
          .filter(({ id, data }) => filters.every((filter) => matchesFilter(data, id, filter)));

        if (shape.order && shape.order !== DOCUMENT_ID_FIELD) {
          // DocumentStore drops documents that lack the ordered field. Reproduced
          // because it is a silent row loss in production, not a fake detail.
          rows = rows.filter(({ id, data }) => keyOf(id, data) !== undefined);
        }
        rows.sort((left, right) => {
          const result = compare(keyOf(left.id, left.data), keyOf(right.id, right.data));
          if (result !== 0) return shape.direction === 'desc' ? -result : result;
          return left.id.localeCompare(right.id);
        });
        if (shape.after !== undefined) {
          rows = rows.filter(({ id, data }) => {
            const result = compare(keyOf(id, data), shape.after);
            return shape.direction === 'desc' ? result < 0 : result > 0;
          });
        }
        if (typeof shape.take === 'number') rows = rows.slice(0, shape.take);
        if (typeof shape.takeLast === 'number') rows = rows.slice(-shape.takeLast);

        // A full document reference, not just its coordinates. Real code
        // carries `doc.ref` out of a query and reads or updates it — often
        // inside a transaction — and a bare {path, id} makes that read come
        // back empty, which reads as "the document vanished" rather than as a
        // missing feature of the fake.
        const docs = rows.map(({ id, path, data }) => ({
          id,
          exists: true,
          ref: docRef(path),
          updateTime: { toDate: () => new Date(0) },
          data: () =>
            shape.fields
              ? Object.fromEntries(
                  shape.fields
                    .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
                    .map((field) => [field, data[field]])
                )
              : data,
        }));
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (callback: (doc: (typeof docs)[number]) => void) => docs.forEach(callback),
        };
      },
    });
    return self;
  }

  const db: Record<string, unknown> = {
    doc: (path: string) => docRef(path),
    listCollections: async () => listCollectionsUnder(''),
    // The batch read. Code that resolves a chunk of ids at once uses this
    // rather than a query, and without it that code has to be written as a
    // collection scan to be testable at all.
    getAll: async (...refs: Array<{ get: () => Promise<unknown> }>) =>
      Promise.all(refs.map((ref) => ref.get())),
    collection: (name: string) => {
      const base = query(name);
      return {
        ...base,
        doc: (id?: string) => docRef(`${name}/${id ?? `auto-${(autoId += 1)}`}`),
        add: async (data: DocumentStoreDocumentData) => {
          const ref = docRef(`${name}/auto-${(autoId += 1)}`);
          writeLog.push(ref.path);
          store.set(ref.path, { ...data });
          return ref;
        },
      };
    },
    batch: () => {
      const staged: Array<[string, DocumentStoreDocumentData | null, 'merge' | 'replace' | 'delete']> =
        [];
      return {
        set: (ref: { path: string }, data: DocumentStoreDocumentData) =>
          staged.push([ref.path, data, 'replace']),
        update: (ref: { path: string }, data: DocumentStoreDocumentData) =>
          staged.push([ref.path, data, 'merge']),
        delete: (ref: { path: string }) => staged.push([ref.path, null, 'delete']),
        commit: async () => {
          for (const [path, data, mode] of staged) {
            writeLog.push(path);
            if (mode === 'delete') store.delete(path);
            else if (mode === 'merge') store.set(path, mergeInto(store.get(path) ?? {}, data!));
            else store.set(path, { ...data });
          }
        },
      };
    },
    async runTransaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      const staged: Array<[string, DocumentStoreDocumentData | null, 'merge' | 'replace' | 'delete']> =
        [];
      const tx = {
        async get(target: { path?: string; get?: () => unknown }) {
          if (typeof target?.get === 'function') return target.get();
          return { empty: true, size: 0, docs: [] };
        },
        create(ref: { path: string }, data: DocumentStoreDocumentData) {
          if (store.has(ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`);
          staged.push([ref.path, data, 'replace']);
        },
        set(ref: { path: string }, data: DocumentStoreDocumentData) {
          staged.push([ref.path, data, 'replace']);
        },
        update(ref: { path: string }, data: DocumentStoreDocumentData) {
          staged.push([ref.path, data, 'merge']);
        },
        delete(ref: { path: string }) {
          staged.push([ref.path, null, 'delete']);
        },
      };
      const value = await callback(tx);
      for (const [path, data, mode] of staged) {
        writeLog.push(path);
        if (mode === 'delete') store.delete(path);
        else if (mode === 'merge') store.set(path, mergeInto(store.get(path) ?? {}, data ?? {}));
        else store.set(path, { ...data });
      }
      return value;
    },
  };

  return { store, writeLog, readLog, queryLog, db: db as never };
}

/** Paths currently in the store under one collection, sorted. */
export function pathsIn(store: Map<string, DocumentStoreDocumentData>, collection: string): string[] {
  return [...store.keys()].filter((path) => path.startsWith(`${collection}/`)).sort();
}
