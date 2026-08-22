import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const repo = process.argv[2];
const dbId = process.argv[3];
const outPath = process.argv[4];
const SAMPLE_CAP = Number(process.argv[5] || 3000);

const sa = JSON.parse(readFileSync(`${repo}/service-account-key.json`, 'utf8'));
const app = initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
});
const db = getFirestore(app, dbId);

const MAX_DISTINCT = 30;
const MAX_VALUE_LEN = 48;

function kindOf(v) {
  if (v === null) return 'null';
  if (v instanceof Timestamp) return 'timestamp';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    if (v.constructor && v.constructor.name === 'DocumentReference') return 'reference';
    if (v.constructor && v.constructor.name === 'GeoPoint') return 'geopoint';
    if (Buffer.isBuffer(v)) return 'bytes';
    return 'map';
  }
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  return typeof v; // string | boolean
}

function newField() {
  return {
    present: 0, kinds: {}, distinct: new Set(), distinctOverflow: false,
    numMin: null, numMax: null, strMaxLen: 0, arrMaxLen: 0,
    arrayElemKinds: {}, samples: [],
  };
}

function record(fields, path, v, depth) {
  let f = fields.get(path);
  if (!f) { f = newField(); fields.set(path, f); }
  f.present += 1;
  const k = kindOf(v);
  f.kinds[k] = (f.kinds[k] || 0) + 1;

  if (k === 'string') {
    f.strMaxLen = Math.max(f.strMaxLen, v.length);
    if (!f.distinctOverflow) {
      if (v.length <= MAX_VALUE_LEN) f.distinct.add(v); else f.distinctOverflow = true;
      if (f.distinct.size > MAX_DISTINCT) { f.distinctOverflow = true; f.distinct.clear(); }
    }
  } else if (k === 'int' || k === 'float') {
    f.numMin = f.numMin === null ? v : Math.min(f.numMin, v);
    f.numMax = f.numMax === null ? v : Math.max(f.numMax, v);
  } else if (k === 'boolean') {
    if (!f.distinctOverflow) f.distinct.add(String(v));
  } else if (k === 'array') {
    f.arrMaxLen = Math.max(f.arrMaxLen, v.length);
    for (const el of v) {
      const ek = kindOf(el);
      f.arrayElemKinds[ek] = (f.arrayElemKinds[ek] || 0) + 1;
      if (ek === 'map' && depth < 3) {
        for (const [ck, cv] of Object.entries(el)) record(fields, `${path}[].${ck}`, cv, depth + 1);
      } else if (ek === 'string' && el.length <= MAX_VALUE_LEN && f.samples.length < 3) {
        if (!f.samples.includes(el)) f.samples.push(el);
      }
    }
  } else if (k === 'map' && depth < 3) {
    for (const [ck, cv] of Object.entries(v)) record(fields, `${path}.${ck}`, cv, depth + 1);
  }
}

const out = { database: dbId, generatedAt: new Date().toISOString(), collections: {} };
const rootCols = await db.listCollections();

for (const col of rootCols) {
  const total = (await col.count().get()).data().count;
  const fields = new Map();
  let scanned = 0;
  const idSamples = [];
  const subcolNames = new Set();

  let last = null;
  while (scanned < Math.min(total, SAMPLE_CAP)) {
    let q = col.orderBy('__name__').limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned += 1;
      if (idSamples.length < 5) idSamples.push(doc.id);
      const data = doc.data();
      for (const [k, v] of Object.entries(data)) record(fields, k, v, 0);
      last = doc;
    }
    if (snap.size < 500) break;
  }

  // subcollection probe on first few docs
  let probe = await col.orderBy('__name__').limit(8).get();
  for (const doc of probe.docs) {
    for (const sc of await doc.ref.listCollections()) subcolNames.add(sc.id);
  }

  out.collections[col.id] = {
    total, scanned, idSamples,
    subcollections: [...subcolNames],
    fields: Object.fromEntries([...fields.entries()].sort().map(([k, f]) => [k, {
      present: f.present,
      presentPct: +(100 * f.present / Math.max(scanned, 1)).toFixed(1),
      kinds: f.kinds,
      distinct: f.distinctOverflow ? null : [...f.distinct].sort().slice(0, MAX_DISTINCT),
      numMin: f.numMin, numMax: f.numMax,
      strMaxLen: f.strMaxLen || undefined,
      arrMaxLen: f.arrMaxLen || undefined,
      arrayElemKinds: Object.keys(f.arrayElemKinds).length ? f.arrayElemKinds : undefined,
      samples: f.samples.length ? f.samples : undefined,
    }])),
  };
  console.error(`profiled ${col.id}: ${scanned}/${total} docs, ${fields.size} field paths, subcols=[${[...subcolNames]}]`);
}

writeFileSync(outPath, JSON.stringify(out, null, 2));
console.error(`\nwrote ${outPath}`);
process.exit(0);
