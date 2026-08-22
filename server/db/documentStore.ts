import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { getPostgresPool } from './client.js';

export type DocumentData = Record<string, any>;
export type OrderByDirection = 'asc' | 'desc';
export type WhereFilterOp =
  | '<'
  | '<='
  | '=='
  | '!='
  | '>='
  | '>'
  | 'array-contains'
  | 'in'
  | 'not-in'
  | 'array-contains-any';

export type SetOptions = { merge?: boolean; mergeFields?: Array<string | FieldPath> };

type DocumentRow = QueryResultRow & {
  collection_path: string;
  document_id: string;
  data: DocumentData;
  created_at: Date;
  updated_at: Date;
};

type Queryable = Pick<PoolClient, 'query'>;

const TIMESTAMP_MARKER = '__edutrack_timestamp_ms__';
const GEOPOINT_MARKER = '__edutrack_geopoint__';

export class GeoPoint {
  constructor(
    readonly latitude: number,
    readonly longitude: number
  ) {}

  isEqual(other: GeoPoint): boolean {
    return this.latitude === other.latitude && this.longitude === other.longitude;
  }
}

export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }

  static fromDate(value: Date): Timestamp {
    return Timestamp.fromMillis(value.getTime());
  }

  static fromMillis(value: number): Timestamp {
    const seconds = Math.floor(value / 1000);
    return new Timestamp(seconds, Math.floor((value - seconds * 1000) * 1_000_000));
  }

  toDate(): Date {
    return new Date(this.toMillis());
  }

  toMillis(): number {
    return this.seconds * 1000 + this.nanoseconds / 1_000_000;
  }

  isEqual(other: Timestamp): boolean {
    return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds;
  }

  valueOf(): string {
    return String(this.toMillis()).padStart(20, '0');
  }
}

type Transform =
  | { kind: 'serverTimestamp' }
  | { kind: 'delete' }
  | { kind: 'increment'; amount: number }
  | { kind: 'arrayUnion'; values: unknown[] }
  | { kind: 'arrayRemove'; values: unknown[] };

function transform(value: Transform): Transform {
  return Object.freeze(value);
}

export class FieldValue {
  static serverTimestamp(): Transform {
    return transform({ kind: 'serverTimestamp' });
  }

  static delete(): Transform {
    return transform({ kind: 'delete' });
  }

  static increment(amount: number): Transform {
    return transform({ kind: 'increment', amount });
  }

  static arrayUnion(...values: unknown[]): Transform {
    return transform({ kind: 'arrayUnion', values });
  }

  static arrayRemove(...values: unknown[]): Transform {
    return transform({ kind: 'arrayRemove', values });
  }
}

export class FieldPath {
  readonly segments: string[];

  constructor(...segments: string[]) {
    this.segments = segments;
  }

  static documentId(): FieldPath {
    return new FieldPath('__name__');
  }

  isEqual(other: FieldPath): boolean {
    return this.segments.join('.') === other.segments.join('.');
  }
}

type AggregateOperation = { kind: 'count' | 'sum' | 'average'; field?: string | FieldPath };

export class AggregateField {
  static count(): AggregateOperation {
    return { kind: 'count' };
  }

  static sum(field: string | FieldPath): AggregateOperation {
    return { kind: 'sum', field };
  }

  static average(field: string | FieldPath): AggregateOperation {
    return { kind: 'average', field };
  }
}

function isTransform(value: unknown): value is Transform {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'kind' in value &&
      ['serverTimestamp', 'delete', 'increment', 'arrayUnion', 'arrayRemove'].includes(
        String((value as { kind?: unknown }).kind)
      )
  );
}

function encode(value: unknown): unknown {
  if (value instanceof Timestamp) return { [TIMESTAMP_MARKER]: value.toMillis() };
  if (value instanceof GeoPoint) {
    return { [GEOPOINT_MARKER]: true, latitude: value.latitude, longitude: value.longitude };
  }
  if (value instanceof Date) return { [TIMESTAMP_MARKER]: value.getTime() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, encode(entry)])
    );
  }
  return value;
}

function decode(value: unknown): any {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record[TIMESTAMP_MARKER] === 'number') {
      return Timestamp.fromMillis(record[TIMESTAMP_MARKER] as number);
    }
    if (
      record[GEOPOINT_MARKER] === true &&
      typeof record.latitude === 'number' &&
      typeof record.longitude === 'number'
    ) {
      return new GeoPoint(record.latitude, record.longitude);
    }
    if (
      typeof record._seconds === 'number' &&
      typeof record._nanoseconds === 'number'
    ) {
      return new Timestamp(record._seconds, record._nanoseconds);
    }
    if (typeof record.seconds === 'number' && typeof record.nanoseconds === 'number') {
      return new Timestamp(record.seconds, record.nanoseconds);
    }
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, decode(entry)]));
  }
  return value;
}

function cloneData<T>(value: T): T {
  return decode(encode(value)) as T;
}

function fieldSegments(field: string | FieldPath): string[] {
  return field instanceof FieldPath ? field.segments : field.split('.').filter(Boolean);
}

function fieldValue(data: DocumentData, field: string | FieldPath, documentId?: string): any {
  const segments = fieldSegments(field);
  if (segments.length === 1 && segments[0] === '__name__') return documentId;
  let value: any = data;
  for (const segment of segments) {
    if (!value || typeof value !== 'object') return undefined;
    value = value[segment];
  }
  return value;
}

function setField(target: DocumentData, field: string | FieldPath, value: unknown): void {
  const segments = fieldSegments(field);
  if (!segments.length || segments[0] === '__name__') return;
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    cursor =
      next && typeof next === 'object' && !Array.isArray(next)
        ? next
        : (cursor[segment] = {});
  }
  cursor[segments[segments.length - 1]] = value;
}

function deleteField(target: DocumentData, field: string | FieldPath): void {
  const segments = fieldSegments(field);
  if (!segments.length) return;
  let cursor: any = target;
  for (const segment of segments.slice(0, -1)) {
    cursor = cursor?.[segment];
    if (!cursor || typeof cursor !== 'object') return;
  }
  delete cursor[segments[segments.length - 1]];
}

function comparable(value: unknown): any {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(encode(left)) === JSON.stringify(encode(right));
}

function applyTransform(current: unknown, operation: Transform): unknown {
  switch (operation.kind) {
    case 'serverTimestamp':
      return Timestamp.now();
    case 'delete':
      return operation;
    case 'increment':
      return (typeof current === 'number' ? current : 0) + operation.amount;
    case 'arrayUnion': {
      const values = Array.isArray(current) ? [...current] : [];
      for (const value of operation.values) {
        if (!values.some((entry) => equal(entry, value))) values.push(cloneData(value));
      }
      return values;
    }
    case 'arrayRemove':
      return (Array.isArray(current) ? current : []).filter(
        (entry) => !operation.values.some((value) => equal(entry, value))
      );
  }
}

function applyWrite(
  current: DocumentData | undefined,
  input: DocumentData,
  options: SetOptions | undefined,
  updateOnly: boolean
): DocumentData {
  const merge = updateOnly || options?.merge === true || Boolean(options?.mergeFields?.length);
  const output: DocumentData = merge ? cloneData(current || {}) : {};
  const fields = options?.mergeFields?.length
    ? options.mergeFields.map((field) => [field, fieldValue(input, field)] as const)
    : Object.entries(input);
  for (const [field, raw] of fields) {
    const previous = fieldValue(output, field);
    const value = isTransform(raw) ? applyTransform(previous, raw) : cloneData(raw);
    if (isTransform(value) && value.kind === 'delete') deleteField(output, field);
    else setField(output, field, value);
  }
  return output;
}

function compare(left: unknown, right: unknown): number {
  const a = comparable(left);
  const b = comparable(right);
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

function matches(value: unknown, operator: WhereFilterOp, expected: unknown): boolean {
  const comparison = compare(value, expected);
  switch (operator) {
    case '==':
      return equal(value, expected);
    case '!=':
      return !equal(value, expected);
    case '<':
      return comparison < 0;
    case '<=':
      return comparison <= 0;
    case '>':
      return comparison > 0;
    case '>=':
      return comparison >= 0;
    case 'in':
      return Array.isArray(expected) && expected.some((entry) => equal(value, entry));
    case 'not-in':
      return Array.isArray(expected) && !expected.some((entry) => equal(value, entry));
    case 'array-contains':
      return Array.isArray(value) && value.some((entry) => equal(entry, expected));
    case 'array-contains-any':
      return (
        Array.isArray(value) &&
        Array.isArray(expected) &&
        value.some((entry) => expected.some((candidate) => equal(entry, candidate)))
      );
  }
}

function splitDocumentPath(path: string): { collectionPath: string; documentId: string } {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2 || parts.length % 2 !== 0) throw new Error(`Invalid document path: ${path}`);
  return { collectionPath: parts.slice(0, -1).join('/'), documentId: parts[parts.length - 1] };
}

function documentPath(collectionPath: string, documentId: string): string {
  return `${collectionPath}/${documentId}`;
}

function writeResult() {
  return { writeTime: Timestamp.now() };
}

export class DocumentSnapshot<T extends DocumentData = DocumentData> {
  readonly ref: DocumentReference<T>;
  readonly id: string;
  readonly exists: boolean;
  readonly createTime?: Timestamp;
  readonly updateTime?: Timestamp;
  protected readonly value?: T;

  constructor(ref: DocumentReference<T>, row?: DocumentRow) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = Boolean(row);
    this.value = row ? (decode(row.data) as T) : undefined;
    this.createTime = row ? Timestamp.fromDate(row.created_at) : undefined;
    this.updateTime = row ? Timestamp.fromDate(row.updated_at) : undefined;
  }

  data(): T | undefined {
    return this.value ? cloneData(this.value) : undefined;
  }

  get(field: string | FieldPath): any {
    return this.value ? cloneData(fieldValue(this.value, field, this.id)) : undefined;
  }

  isEqual(other: DocumentSnapshot<T>): boolean {
    return this.ref.isEqual(other.ref) && equal(this.value, other.value);
  }
}

export class QueryDocumentSnapshot<T extends DocumentData = DocumentData> extends DocumentSnapshot<T> {
  declare readonly exists: true;

  override data(): T {
    return super.data() as T;
  }
}

export class QuerySnapshot<T extends DocumentData = DocumentData> {
  readonly docs: QueryDocumentSnapshot<T>[];
  readonly size: number;
  readonly empty: boolean;

  constructor(docs: QueryDocumentSnapshot<T>[]) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }

  forEach(callback: (document: QueryDocumentSnapshot<T>) => void): void {
    this.docs.forEach(callback);
  }
}

type WhereClause = { field: string | FieldPath; operator: WhereFilterOp; value: unknown };
type OrderClause = { field: string | FieldPath; direction: OrderByDirection };

export class Query<T extends DocumentData = DocumentData> {
  protected readonly store: PostgresDocumentStore;
  readonly collectionPath: string;
  protected readonly wheres: WhereClause[];
  protected readonly orders: OrderClause[];
  protected readonly maxRows?: number;
  protected readonly lastRows?: number;
  protected readonly cursor?: unknown[];
  protected readonly selected?: Array<string | FieldPath>;

  constructor(
    store: PostgresDocumentStore,
    collectionPath: string,
    state: {
      wheres?: WhereClause[];
      orders?: OrderClause[];
      maxRows?: number;
      lastRows?: number;
      cursor?: unknown[];
      selected?: Array<string | FieldPath>;
    } = {}
  ) {
    this.store = store;
    this.collectionPath = collectionPath;
    this.wheres = state.wheres || [];
    this.orders = state.orders || [];
    this.maxRows = state.maxRows;
    this.lastRows = state.lastRows;
    this.cursor = state.cursor;
    this.selected = state.selected;
  }

  protected next(state: Partial<{
    wheres: WhereClause[];
    orders: OrderClause[];
    maxRows: number;
    lastRows: number;
    cursor: unknown[];
    selected: Array<string | FieldPath>;
  }>): Query<T> {
    return new Query<T>(this.store, this.collectionPath, {
      wheres: state.wheres || this.wheres,
      orders: state.orders || this.orders,
      maxRows: state.maxRows ?? this.maxRows,
      lastRows: state.lastRows ?? this.lastRows,
      cursor: state.cursor || this.cursor,
      selected: state.selected || this.selected,
    });
  }

  where(field: string | FieldPath, operator: WhereFilterOp, value: unknown): Query<T> {
    return this.next({ wheres: [...this.wheres, { field, operator, value }] });
  }

  orderBy(field: string | FieldPath, direction: OrderByDirection = 'asc'): Query<T> {
    return this.next({ orders: [...this.orders, { field, direction }] });
  }

  limit(value: number): Query<T> {
    return this.next({ maxRows: Math.max(0, Math.floor(value)) });
  }

  limitToLast(value: number): Query<T> {
    return this.next({ lastRows: Math.max(0, Math.floor(value)) });
  }

  startAfter(...values: unknown[]): Query<T> {
    if (values[0] instanceof DocumentSnapshot) {
      const snapshot = values[0] as DocumentSnapshot<T>;
      const data = snapshot.data() || ({} as T);
      const orders = this.orders.length ? this.orders : [{ field: FieldPath.documentId(), direction: 'asc' as const }];
      return this.next({ cursor: orders.map((order) => fieldValue(data, order.field, snapshot.id)) });
    }
    return this.next({ cursor: values });
  }

  select(...fields: Array<string | FieldPath>): Query<T> {
    return this.next({ selected: fields });
  }

  withConverter<U extends DocumentData>(): Query<U> {
    return this as unknown as Query<U>;
  }

  count(): AggregateQuery {
    return new AggregateQuery(this, { count: AggregateField.count() });
  }

  aggregate(spec: Record<string, AggregateOperation>): AggregateQuery {
    return new AggregateQuery(this, spec);
  }

  async get(): Promise<QuerySnapshot<T>> {
    return this.execute(this.store.queryable);
  }

  async execute(queryable: Queryable, lock = false): Promise<QuerySnapshot<T>> {
    const result = await queryable.query<DocumentRow>(
      `select collection_path, document_id, data, created_at, updated_at
         from app_documents
        where collection_path = $1${lock ? ' for update' : ''}`,
      [this.collectionPath]
    );
    let docs = result.rows.map(
      (row) =>
        new QueryDocumentSnapshot<T>(
          new DocumentReference<T>(this.store, this.collectionPath, row.document_id),
          row
        )
    );
    docs = docs.filter((document) => {
      const data = document.data();
      return this.wheres.every((where) =>
        matches(fieldValue(data, where.field, document.id), where.operator, where.value)
      );
    });
    const orders = this.orders.length
      ? this.orders
      : [{ field: FieldPath.documentId(), direction: 'asc' as const }];
    docs.sort((left, right) => {
      const leftData = left.data();
      const rightData = right.data();
      for (const order of orders) {
        const result = compare(
          fieldValue(leftData, order.field, left.id),
          fieldValue(rightData, order.field, right.id)
        );
        if (result) return order.direction === 'desc' ? -result : result;
      }
      return left.id.localeCompare(right.id);
    });
    if (this.cursor) {
      docs = docs.filter((document) => {
        const data = document.data();
        for (let index = 0; index < orders.length; index += 1) {
          const order = orders[index];
          const result = compare(
            fieldValue(data, order.field, document.id),
            this.cursor?.[index]
          );
          if (!result) continue;
          return order.direction === 'desc' ? result < 0 : result > 0;
        }
        return false;
      });
    }
    if (this.maxRows !== undefined) docs = docs.slice(0, this.maxRows);
    if (this.lastRows !== undefined) {
      docs = this.lastRows === 0 ? [] : docs.slice(-this.lastRows);
    }
    if (this.selected) {
      docs = docs.map((document) => {
        const projected: DocumentData = {};
        for (const field of this.selected || []) {
          const value = fieldValue(document.data(), field, document.id);
          if (value !== undefined) setField(projected, field, value);
        }
        const now = new Date();
        return new QueryDocumentSnapshot<T>(document.ref, {
          collection_path: this.collectionPath,
          document_id: document.id,
          data: encode(projected) as DocumentData,
          created_at: document.createTime?.toDate() || now,
          updated_at: document.updateTime?.toDate() || now,
        });
      });
    }
    return new QuerySnapshot(docs);
  }
}

export class AggregateQuerySnapshot<T extends Record<string, number> = Record<string, number>> {
  constructor(private readonly value: T) {}
  data(): T {
    return { ...this.value };
  }
}

export class AggregateQuery {
  constructor(
    private readonly query: Query,
    private readonly spec: Record<string, AggregateOperation>
  ) {}

  async get(): Promise<AggregateQuerySnapshot> {
    const snapshot = await this.query.get();
    const result: Record<string, number> = {};
    for (const [key, operation] of Object.entries(this.spec)) {
      if (operation.kind === 'count') {
        result[key] = snapshot.size;
        continue;
      }
      const values = snapshot.docs
        .map((document) => Number(fieldValue(document.data(), operation.field!)))
        .filter(Number.isFinite);
      const sum = values.reduce((total, value) => total + value, 0);
      result[key] = operation.kind === 'sum' ? sum : values.length ? sum / values.length : 0;
    }
    return new AggregateQuerySnapshot(result);
  }
}

export class CollectionReference<T extends DocumentData = DocumentData> extends Query<T> {
  readonly id: string;
  readonly path: string;
  readonly parent: DocumentReference | null;

  constructor(store: PostgresDocumentStore, collectionPath: string) {
    super(store, collectionPath);
    this.path = collectionPath;
    const parts = collectionPath.split('/');
    this.id = parts[parts.length - 1];
    this.parent = parts.length > 1 ? store.doc(parts.slice(0, -1).join('/')) : null;
  }

  doc(id: string = randomUUID()): DocumentReference<T> {
    return new DocumentReference<T>(this.store, this.collectionPath, id);
  }

  async add(data: T): Promise<DocumentReference<T>> {
    const reference = this.doc();
    await reference.create(data);
    return reference;
  }

  override withConverter<U extends DocumentData>(): CollectionReference<U> {
    return this as unknown as CollectionReference<U>;
  }
}

export class DocumentReference<T extends DocumentData = DocumentData> {
  readonly id: string;
  readonly path: string;
  readonly parent: CollectionReference<T>;
  readonly documentStore: PostgresDocumentStore;

  constructor(
    store: PostgresDocumentStore,
    readonly collectionPath: string,
    id: string
  ) {
    if (!id || id.includes('/')) throw new Error(`Invalid document id: ${id}`);
    this.documentStore = store;
    this.id = id;
    this.path = documentPath(collectionPath, id);
    this.parent = new CollectionReference<T>(store, collectionPath);
  }

  collection<U extends DocumentData = DocumentData>(name: string): CollectionReference<U> {
    return new CollectionReference<U>(this.documentStore, `${this.path}/${name}`);
  }

  async get(): Promise<DocumentSnapshot<T>> {
    return this.getWith(this.documentStore.queryable);
  }

  async getWith(queryable: Queryable, lock = false): Promise<DocumentSnapshot<T>> {
    const result = await queryable.query<DocumentRow>(
      `select collection_path, document_id, data, created_at, updated_at
         from app_documents
        where collection_path = $1 and document_id = $2${lock ? ' for update' : ''}`,
      [this.collectionPath, this.id]
    );
    return new DocumentSnapshot(this, result.rows[0]);
  }

  async set(data: T, options?: SetOptions): Promise<ReturnType<typeof writeResult>> {
    return this.setWith(this.documentStore.queryable, data, options);
  }

  async setWith(
    queryable: Queryable,
    data: T,
    options?: SetOptions
  ): Promise<ReturnType<typeof writeResult>> {
    const current = options?.merge || options?.mergeFields?.length
      ? (await this.getWith(queryable, true)).data()
      : undefined;
    const next = applyWrite(current, data, options, false);
    await queryable.query(
      `insert into app_documents (collection_path, document_id, data)
       values ($1, $2, $3::jsonb)
       on conflict (collection_path, document_id) do update
         set data = excluded.data, updated_at = now()`,
      [this.collectionPath, this.id, JSON.stringify(encode(next))]
    );
    return writeResult();
  }

  async create(data: T): Promise<ReturnType<typeof writeResult>> {
    return this.createWith(this.documentStore.queryable, data);
  }

  async createWith(queryable: Queryable, data: T): Promise<ReturnType<typeof writeResult>> {
    await queryable.query(
      `insert into app_documents (collection_path, document_id, data) values ($1, $2, $3::jsonb)`,
      [this.collectionPath, this.id, JSON.stringify(encode(applyWrite(undefined, data, undefined, false)))]
    );
    return writeResult();
  }

  async update(data: Partial<T>, ...precondition: unknown[]): Promise<ReturnType<typeof writeResult>> {
    void precondition;
    return this.updateWith(this.documentStore.queryable, data);
  }

  async updateWith(
    queryable: Queryable,
    data: Partial<T>
  ): Promise<ReturnType<typeof writeResult>> {
    const current = await this.getWith(queryable, true);
    if (!current.exists) throw Object.assign(new Error(`Document not found: ${this.path}`), { code: 5 });
    const next = applyWrite(current.data(), data as DocumentData, undefined, true);
    await queryable.query(
      `update app_documents set data = $3::jsonb, updated_at = now()
        where collection_path = $1 and document_id = $2`,
      [this.collectionPath, this.id, JSON.stringify(encode(next))]
    );
    return writeResult();
  }

  async delete(): Promise<ReturnType<typeof writeResult>> {
    return this.deleteWith(this.documentStore.queryable);
  }

  async deleteWith(queryable: Queryable): Promise<ReturnType<typeof writeResult>> {
    await queryable.query(
      'delete from app_documents where collection_path = $1 and document_id = $2',
      [this.collectionPath, this.id]
    );
    return writeResult();
  }

  isEqual(other: DocumentReference): boolean {
    return this.path === other.path;
  }

  withConverter<U extends DocumentData>(): DocumentReference<U> {
    return this as unknown as DocumentReference<U>;
  }
}

export class Transaction {
  private readonly operations: BatchOperation[] = [];

  constructor(private readonly queryable: PoolClient) {}

  get<T extends DocumentData>(reference: DocumentReference<T>): Promise<DocumentSnapshot<T>>;
  get<T extends DocumentData>(query: Query<T>): Promise<QuerySnapshot<T>>;
  get<T extends DocumentData>(target: DocumentReference<T> | Query<T>) {
    return target instanceof DocumentReference
      ? target.getWith(this.queryable, true)
      : target.execute(this.queryable, true);
  }

  async getAll<T extends DocumentData>(...references: DocumentReference<T>[]) {
    return Promise.all(references.map((reference) => reference.getWith(this.queryable, true)));
  }

  set<T extends DocumentData>(reference: DocumentReference<T>, data: T, options?: SetOptions): this {
    this.operations.push((client) => reference.setWith(client, data, options));
    return this;
  }

  create<T extends DocumentData>(reference: DocumentReference<T>, data: T): this {
    this.operations.push((client) => reference.createWith(client, data));
    return this;
  }

  update<T extends DocumentData>(
    reference: DocumentReference<T>,
    data: Partial<T>,
    ..._precondition: unknown[]
  ): this {
    this.operations.push((client) => reference.updateWith(client, data));
    return this;
  }

  delete(reference: DocumentReference): this {
    this.operations.push((client) => reference.deleteWith(client));
    return this;
  }

  async flush(): Promise<void> {
    for (const operation of this.operations) await operation(this.queryable);
  }
}

type BatchOperation = (client: PoolClient) => Promise<unknown>;

export class WriteBatch {
  private readonly operations: BatchOperation[] = [];
  constructor(private readonly store: PostgresDocumentStore) {}

  set<T extends DocumentData>(reference: DocumentReference<T>, data: T, options?: SetOptions): this {
    this.operations.push((client) => reference.setWith(client, data, options));
    return this;
  }

  create<T extends DocumentData>(reference: DocumentReference<T>, data: T): this {
    this.operations.push((client) => reference.createWith(client, data));
    return this;
  }

  update<T extends DocumentData>(
    reference: DocumentReference<T>,
    data: Partial<T>,
    ..._precondition: unknown[]
  ): this {
    this.operations.push((client) => reference.updateWith(client, data));
    return this;
  }

  delete(reference: DocumentReference): this {
    this.operations.push((client) => reference.deleteWith(client));
    return this;
  }

  async commit(): Promise<Array<ReturnType<typeof writeResult>>> {
    const client = await getPostgresPool().connect();
    try {
      await client.query('begin');
      const results = [];
      for (const operation of this.operations) {
        await operation(client);
        results.push(writeResult());
      }
      await client.query('commit');
      return results;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresDocumentStore {
  get queryable(): Queryable {
    return getPostgresPool();
  }

  collection<T extends DocumentData = DocumentData>(path: string): CollectionReference<T> {
    return new CollectionReference<T>(this, path.replace(/^\/+|\/+$/g, ''));
  }

  doc<T extends DocumentData = DocumentData>(path: string): DocumentReference<T> {
    const { collectionPath, documentId } = splitDocumentPath(path);
    return new DocumentReference<T>(this, collectionPath, documentId);
  }

  batch(): WriteBatch {
    return new WriteBatch(this);
  }

  async getAll<T extends DocumentData>(...references: DocumentReference<T>[]) {
    return Promise.all(references.map((reference) => reference.get()));
  }

  async listCollections(): Promise<CollectionReference[]> {
    const result = await this.queryable.query<{ collection_path: string }>(
      `select distinct collection_path
         from app_documents
        where collection_path !~ '/'
        order by collection_path`
    );
    return result.rows.map((row) => this.collection(row.collection_path));
  }

  async runTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const client = await getPostgresPool().connect();
      try {
        await client.query('begin isolation level serializable');
        const transaction = new Transaction(client);
        const result = await callback(transaction);
        await transaction.flush();
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        if ((error as { code?: unknown })?.code === '40001' && attempt < 2) continue;
        throw error;
      } finally {
        client.release();
      }
    }
    throw new Error('Transaction retry limit exceeded');
  }
}

export { PostgresDocumentStore as DocumentStore };

/**
 * Compatibility helpers for maintenance scripts that use the document-store
 * API. Every helper below returns the native PostgreSQL implementation.
 */
export type ServiceAccount = {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  [key: string]: unknown;
};
export type App = { name: string; options: Record<string, any> };
const compatibilityApps: App[] = [];
const defaultDocumentStore = new PostgresDocumentStore();

export function cert<T>(value: T): T {
  return value;
}

export function initializeApp(_options?: unknown, name = '[DEFAULT]'): App {
  const existing = compatibilityApps.find((app) => app.name === name);
  if (existing) return existing;
  const app = {
    name,
    options: (_options && typeof _options === 'object' ? _options : {}) as Record<string, any>,
  };
  compatibilityApps.push(app);
  return app;
}

export function getApps(): App[] {
  return [...compatibilityApps];
}

export function getApp(name = '[DEFAULT]'): App {
  return compatibilityApps.find((app) => app.name === name) || initializeApp(undefined, name);
}

export async function deleteApp(app: App): Promise<void> {
  const index = compatibilityApps.indexOf(app);
  if (index >= 0) compatibilityApps.splice(index, 1);
}

export function getDocumentStore(_app?: App, _databaseId?: string): PostgresDocumentStore {
  return defaultDocumentStore;
}

declare global {
  namespace AppDocumentStore {
    type DocumentStore = PostgresDocumentStore;
    type DocumentData = import('./documentStore.js').DocumentData;
    type DocumentReference<T extends DocumentData = DocumentData> = import('./documentStore.js').DocumentReference<T>;
    type DocumentSnapshot<T extends DocumentData = DocumentData> = import('./documentStore.js').DocumentSnapshot<T>;
    type QueryDocumentSnapshot<T extends DocumentData = DocumentData> = import('./documentStore.js').QueryDocumentSnapshot<T>;
    type QuerySnapshot<T extends DocumentData = DocumentData> = import('./documentStore.js').QuerySnapshot<T>;
    type Query<T extends DocumentData = DocumentData> = import('./documentStore.js').Query<T>;
    type CollectionReference<T extends DocumentData = DocumentData> = import('./documentStore.js').CollectionReference<T>;
    type Transaction = import('./documentStore.js').Transaction;
    type WriteBatch = import('./documentStore.js').WriteBatch;
    type Timestamp = import('./documentStore.js').Timestamp;
    type FieldValue = import('./documentStore.js').FieldValue;
    type AggregateQuerySnapshot<T extends Record<string, number> = Record<string, number>> = import('./documentStore.js').AggregateQuerySnapshot<T>;
  }
}
