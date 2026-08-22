import type { ApiRequest } from '../../lib/http/types.js';
import type { DocumentStore, Query } from '../../../db/documentStore.js';
import { requireRole, type UserContext } from '../../lib/auth/authz.js';
import { docData, getLimit } from './utils.js';

function value(req: ApiRequest, key: string): string {
  const raw = req.query[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

export async function readKnowledgeBankDocuments(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin', 'teacher', 'student', 'parent', 'accounting', 'office']);
  const snap = await db
    .collection('knowledge_bank')
    .orderBy('createdAt', 'desc')
    .limit(getLimit(req, 200))
    .get();
  return { items: snap.docs.map(docData) };
}

export async function readPrintRequestDocuments(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin', 'teacher', 'office']);
  let query: Query = db.collection('print_requests');
  if (ctx.role === 'teacher') query = query.where('teacherId', '==', ctx.uid);

  const status = value(req, 'status');
  const neededDate = value(req, 'neededDate');
  const createdDate = value(req, 'createdDate');
  if (status && status !== 'all') query = query.where('status', '==', status);
  if (neededDate) query = query.where('neededDate', '==', neededDate);
  if (createdDate) query = query.where('createdDate', '==', createdDate);

  const snap = await query
    .orderBy('createdAt', 'desc')
    .limit(getLimit(req, 200))
    .get();
  return { requests: snap.docs.map(docData) };
}

export async function readTeacherAvailabilityDocuments(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin', 'teacher', 'office']);
  const view = value(req, 'view') || 'profiles';
  const limit = getLimit(req, 200);

  if (view === 'profiles') {
    let query: Query = db.collection('teacher_availability_profiles');
    if (ctx.role === 'teacher') query = query.where('teacherId', '==', ctx.uid);
    const snap = await query.orderBy('teacherName', 'asc').limit(limit).get();
    return { profiles: snap.docs.map(docData) };
  }

  if (view !== 'pending') {
    throw Object.assign(new Error('Unknown teacher availability view'), { statusCode: 400 });
  }
  let query: Query = db
    .collection('teacher_availability_change_requests')
    .where('status', '==', 'pending');
  if (ctx.role === 'teacher') query = query.where('teacherId', '==', ctx.uid);
  const snap = await query.orderBy('createdAt', 'desc').limit(limit).get();
  return { requests: snap.docs.map(docData) };
}

export async function readSubstituteRequestDocuments(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin', 'teacher', 'accounting', 'office']);
  const requestedLimit = getLimit(req, 200);
  let query: Query = db.collection('substitute_requests');
  const status = value(req, 'status');
  const classId = value(req, 'classId');
  const date = value(req, 'date');
  if (status) query = query.where('status', '==', status);
  if (classId) query = query.where('classId', '==', classId);
  if (date) query = query.where('date', '==', date);

  const snap = await query
    .orderBy('date', 'desc')
    .limit(ctx.role === 'teacher' ? 2000 : requestedLimit)
    .get();
  const requests = snap.docs
    .map(docData)
    .filter((request) => {
      if (ctx.role !== 'teacher') return true;
      return (
        request.status === 'pending' ||
        request.requestingTeacherId === ctx.uid ||
        request.substituteTeacherId === ctx.uid
      );
    })
    .slice(0, requestedLimit);
  return { requests };
}

export async function readStaffPasswordResetRequestDocuments(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin']);
  const snap = await db
    .collection('staffPasswordResetRequests')
    .orderBy('createdAt', 'desc')
    .limit(getLimit(req, 200))
    .get();
  return { requests: snap.docs.map(docData) };
}
