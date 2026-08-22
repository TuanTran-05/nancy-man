import type {
  DocumentReference,
  DocumentSnapshot,
  DocumentStore,
  QueryDocumentSnapshot,
} from '@/server/db/documentStore.js';
import { normalizePhoneVN } from '../../../../shared/phone.js';
import { isArchivedLifecycle, isCurrentLifecycle } from '../../../../shared/studentLifecycle.js';

const ADMISSION_MATCH_QUERY_LIMIT = 10;

export type AdmissionMatchInput = {
  name: string;
  dob: string;
  contact: string;
};

export type AdmissionStudentMatch = {
  id: string;
  ref?: DocumentReference;
  data: Record<string, unknown>;
  reasons: string[];
};

export function normalizeAdmissionName(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeAdmissionContact(value: unknown): string {
  const raw = String(value || '').trim();
  return normalizePhoneVN(raw).replace(/\s+/g, '').toLowerCase();
}

export function buildAdmissionSearchFields(input: AdmissionMatchInput) {
  return {
    admissionSearchName: normalizeAdmissionName(input.name),
    admissionSearchDob: input.dob.trim(),
    admissionSearchContact: normalizeAdmissionContact(input.contact),
  };
}

function matchDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  input: AdmissionMatchInput
): AdmissionStudentMatch {
  const data = doc.data() || {};
  const search = buildAdmissionSearchFields(input);
  const nameMatches =
    String(data.admissionSearchName || normalizeAdmissionName(data.name)) ===
    search.admissionSearchName;
  const dobMatches =
    String(data.admissionSearchDob || data.dob || '') === search.admissionSearchDob;
  const contactMatches =
    normalizeAdmissionContact(data.admissionSearchContact || data.contact) ===
    search.admissionSearchContact;
  const reasons = [
    ...(nameMatches ? ['name'] : []),
    ...(dobMatches ? ['dob'] : []),
    ...(contactMatches ? ['contact'] : []),
  ];
  return { id: doc.id, ref: doc.ref, data, reasons };
}

export async function findAdmissionMatches(db: DocumentStore, input: AdmissionMatchInput) {
  const search = buildAdmissionSearchFields(input);
  const contactLookups = new Set([search.admissionSearchContact, input.contact.trim()]);
  if (search.admissionSearchContact.startsWith('84')) {
    contactLookups.add(`+${search.admissionSearchContact}`);
    contactLookups.add(`0${search.admissionSearchContact.slice(2)}`);
  }
  const snapshots = await Promise.all([
    db
      .collection('students')
      .where('dob', '==', input.dob)
      .limit(ADMISSION_MATCH_QUERY_LIMIT)
      .get(),
    db
      .collection('students')
      .where('admissionSearchName', '==', search.admissionSearchName)
      .limit(ADMISSION_MATCH_QUERY_LIMIT)
      .get(),
    ...[...contactLookups].flatMap((contact) => [
      db
        .collection('students')
        .where('admissionSearchContact', '==', contact)
        .limit(ADMISSION_MATCH_QUERY_LIMIT)
        .get(),
      // Supports older documents that have not yet acquired normalized admission fields.
      db
        .collection('students')
        .where('contact', '==', contact)
        .limit(ADMISSION_MATCH_QUERY_LIMIT)
        .get(),
    ]),
  ]);
  const documents = new Map<string, QueryDocumentSnapshot>();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      documents.set(doc.id, doc);
    }
  }
  const matches = [...documents.values()].map((doc) => matchDoc(doc, input));
  const exactMatches = matches.filter((match) => match.reasons.length === 3);
  const currentExactMatches = exactMatches.filter((match) => isCurrentLifecycle(match.data));
  const archivedExactMatches = exactMatches.filter((match) => isArchivedLifecycle(match.data));
  const possibleMatches = matches.filter((match) => match.reasons.length === 2);
  return {
    exactMatches,
    currentExactMatches,
    archivedExactMatches,
    possibleMatches,
  };
}

export function assertSelectedArchivedMatch(
  selected: AdmissionStudentMatch | null
): AdmissionStudentMatch {
  if (!selected) {
    throw Object.assign(new Error('Selected historical student was not found'), {
      statusCode: 404,
    });
  }
  if (!isArchivedLifecycle(selected.data)) {
    throw Object.assign(new Error('Selected student is not archived'), { statusCode: 409 });
  }
  return selected;
}
