import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { readFileSync } from 'fs';
import formidable, { type File as FormidableFile } from 'formidable';
import { normalizeBody, getString } from '../../lib/http/helpers.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import {
  buildAssignmentPayloadFromAuthoringDraft,
  AUTHORING_BANK_VISIBILITIES,
  type AuthoringBankVisibility,
  type AuthoringImportReport,
} from '../../../../shared/assignmentAuthoring.js';
import { assignmentAssessmentInputSchema } from '../../../../shared/assignmentAssessment.js';
import { normalizeAssignmentProctoringMode } from '../../../../shared/assignmentProctoring.js';
import {
  normalizeAssignmentDeliveryPolicy,
  validateAssignmentDeliveryPolicy,
} from '../../../../shared/assignmentDelivery.js';
import { handleAssignmentCreate } from './assignments.js';
import { parseAuthoringImportBuffer } from '../../lib/assignmentAuthoring/assignmentImport.js';
import {
  buildAuthoringImportTemplate,
  type AuthoringImportTemplateFormat,
} from '../../lib/assignmentAuthoring/assignmentImportTemplates.js';

function canReviewSharedBank(role: string) {
  return role === 'admin';
}

function requireTeacherLike(role: string) {
  if (role !== 'teacher' && role !== 'admin') {
    const err = Object.assign(new Error('Teacher role required'), { statusCode: 403 });
    throw err;
  }
}

function requireTeacher(role: string) {
  if (role !== 'teacher') {
    const err = Object.assign(new Error('Teacher role required'), { statusCode: 403 });
    throw err;
  }
}

function getTemplateFormat(req: ApiRequest): AuthoringImportTemplateFormat {
  const format = typeof req.query.format === 'string' ? req.query.format : '';
  if (format === 'xlsx' || format === 'csv' || format === 'docx') return format;
  throw Object.assign(new Error('Unsupported import template format'), { statusCode: 400 });
}

export async function handleAssignmentDraftImportTemplate(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  requireTeacher(role);

  const template = await buildAuthoringImportTemplate(getTemplateFormat(req));
  writeAuditLog(db, {
    userId: uid,
    userRole: role,
    action: 'export',
    collection: 'assignment_authoring_imports',
    documentId: template.filename,
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write authoring import template:', err));

  res.setHeader('Content-Type', template.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${template.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(template.buffer);
}

function draftCollection(db: DocumentStore) {
  return db.collection('assignment_authoring_drafts');
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeReportCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function normalizeImportReport(value: unknown): AuthoringImportReport | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const report = value as Record<string, unknown>;
  const source = String(report.source || '');
  const mode = String(report.mode || '');
  const filename = String(report.filename || '').trim();
  const appliedAt = String(report.appliedAt || '').trim();
  if (!filename || !appliedAt) return undefined;
  if (source !== 'xlsx' && source !== 'csv' && source !== 'docx') return undefined;
  if (mode !== 'append' && mode !== 'replace') return undefined;
  return {
    filename,
    source,
    appliedAt,
    mode,
    totalQuestions: normalizeReportCount(report.totalQuestions),
    validQuestions: normalizeReportCount(report.validQuestions),
    warningCount: normalizeReportCount(report.warningCount),
    errorCount: normalizeReportCount(report.errorCount),
  };
}

export async function handleAssignmentDraftSave(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacher(role);

  const body = normalizeBody(req.body);
  const id = getString(body, 'id') || draftCollection(db).doc().id;
  const parsedAssessment = assignmentAssessmentInputSchema.safeParse(body.assessmentDraft);
  if (!parsedAssessment.success) {
    return res.status(400).json({
      success: false,
      error: parsedAssessment.error.issues.map((issue) => issue.message).join('; '),
    });
  }

  const ref = draftCollection(db).doc(id);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : null;
  if (existing && existing.ownerUid !== uid && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }
  const incomingRevision = Number(body.serverRevision || 0);
  const currentRevision = Number(existing?.serverRevision || 0);
  if (existing && incomingRevision !== currentRevision) {
    return res.status(409).json({
      success: false,
      error: 'Draft conflict',
      data: { serverRevision: currentRevision, draft: { id: snap.id, ...existing } },
    });
  }

  const timestamp = nowIso();
  const lastImportReport = normalizeImportReport(body.lastImportReport);
  const deliveryPolicy = body.deliveryPolicy
    ? validateAssignmentDeliveryPolicy(normalizeAssignmentDeliveryPolicy(body.deliveryPolicy))
    : existing?.deliveryPolicy || normalizeAssignmentDeliveryPolicy(undefined);

  const payload = {
    id,
    ownerUid: existing?.ownerUid || uid,
    title: getString(body, 'title'),
    description: getString(body, 'description'),
    classId: getString(body, 'classId'),
    dueDate: getString(body, 'dueDate'),
    attemptsAllowed: Math.max(Number(body.attemptsAllowed || 1), 1),
    proctoringMode: normalizeAssignmentProctoringMode(body.proctoringMode),
    assessmentDraft: parsedAssessment.data,
    status: 'draft',
    localRevision: Number(body.localRevision || 0),
    serverRevision: currentRevision + 1,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    deliveryPolicy,
    ...(lastImportReport ? { lastImportReport } : {}),
  };

  await ref.set(payload, { merge: true });
  writeAuditLog(db, {
    userId: uid,
    userRole: role,
    action: 'update',
    collection: 'assignment_authoring_drafts',
    documentId: id,
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write authoring draft save:', err));

  return res.status(200).json({ success: true, data: payload });
}

export async function handleAssignmentDraftList(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacher(role);
  const snap = await draftCollection(db)
    .where('ownerUid', '==', uid)
    .where('status', '==', 'draft')
    .orderBy('updatedAt', 'desc')
    .limit(25)
    .get();
  return res
    .status(200)
    .json({ success: true, data: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
}

export async function handleAssignmentDraftGet(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacher(role);
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ success: false, error: 'Missing draft id' });
  const snap = await draftCollection(db).doc(id).get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Draft not found' });
  const data = snap.data()!;
  if (data.ownerUid !== uid)
    return res.status(403).json({ success: false, error: 'Not authorized' });
  return res.status(200).json({ success: true, data: { id: snap.id, ...data } });
}

export async function handleAssignmentDraftDelete(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'DELETE')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacher(role);
  const body = normalizeBody(req.body);
  const id = getString(body, 'id') || (typeof req.query.id === 'string' ? req.query.id : '');
  if (!id) return res.status(400).json({ success: false, error: 'Missing draft id' });
  const ref = draftCollection(db).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Draft not found' });
  const data = snap.data()!;
  if (data.ownerUid !== uid)
    return res.status(403).json({ success: false, error: 'Not authorized' });
  await ref.set({ status: 'archived', updatedAt: nowIso() }, { merge: true });
  return res.status(200).json({ success: true, id });
}

export async function handleAssignmentDraftPublish(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacher(role);
  const body = normalizeBody(req.body);
  const id = getString(body, 'id');
  if (!id) return res.status(400).json({ success: false, error: 'Missing draft id' });
  const ref = draftCollection(db).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Draft not found' });
  const data = snap.data()!;
  if (data.ownerUid !== uid)
    return res.status(403).json({ success: false, error: 'Not authorized' });

  const assignmentPayload = buildAssignmentPayloadFromAuthoringDraft({
    id: snap.id,
    ownerUid: data.ownerUid,
    title: String(data.title || ''),
    description: String(data.description || ''),
    classId: String(data.classId || ''),
    dueDate: String(data.dueDate || ''),
    attemptsAllowed: Number(data.attemptsAllowed || 1),
    proctoringMode: normalizeAssignmentProctoringMode(data.proctoringMode),
    assessmentDraft: data.assessmentDraft,
    status: 'draft',
    localRevision: 0,
    serverRevision: Number(data.serverRevision || 0),
    createdAt: String(data.createdAt || nowIso()),
    updatedAt: String(data.updatedAt || nowIso()),
    deliveryPolicy: normalizeAssignmentDeliveryPolicy(data.deliveryPolicy),
  });

  const publishReq = {
    ...req,
    method: 'POST',
    body: assignmentPayload,
  } as unknown as ApiRequest;
  const originalJson = res.json.bind(res);
  let publishedId = '';
  res.json = ((payload: unknown) => {
    if (payload && typeof payload === 'object' && 'id' in payload) {
      publishedId = String((payload as { id?: unknown }).id || '');
    }
    return originalJson(payload);
  }) as typeof res.json;
  await handleAssignmentCreate(publishReq, res, db, uid, role);
  const isSuccess = res.statusCode === 200 || res.statusCode === 201;
  if (isSuccess && publishedId) {
    await ref.set(
      { status: 'published', publishedAssignmentId: publishedId, updatedAt: nowIso() },
      { merge: true }
    );
  }
}

function isBankVisibility(value: unknown): value is AuthoringBankVisibility {
  return AUTHORING_BANK_VISIBILITIES.includes(value as AuthoringBankVisibility);
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) =>
          String(item || '')
            .trim()
            .toLowerCase()
        )
        .filter((item) => item.length > 0)
        .slice(0, 20)
    )
  );
}

function canReadBankItem(data: any, uid: string, role: string) {
  return data.visibility === 'shared' || data.ownerUid === uid || canReviewSharedBank(role);
}

function getQueryString(req: ApiRequest, key: string) {
  const value = req.query[key];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function includesSearchText(value: unknown, query: string) {
  if (!query) return true;
  if (Array.isArray(value)) {
    return value.some((item) => includesSearchText(item, query));
  }
  return String(value || '')
    .toLowerCase()
    .includes(query);
}

function matchesBankSearch(item: any, query: string) {
  return (
    includesSearchText(item.prompt, query) ||
    includesSearchText(item.title, query) ||
    includesSearchText(item.tags, query) ||
    includesSearchText(item.level, query) ||
    includesSearchText(item.skill, query) ||
    includesSearchText(item.responseMode, query)
  );
}

async function getOwnedBankItem(
  db: DocumentStore,
  collectionName: string,
  id: string,
  uid: string,
  role: string
) {
  const ref = db.collection(collectionName).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('Bank item not found'), { statusCode: 404 });
  const data = snap.data()!;
  if (data.ownerUid !== uid && !canReviewSharedBank(role)) {
    throw Object.assign(new Error('Not authorized'), { statusCode: 403 });
  }
  return { ref, data };
}

export async function handleQuestionBankCreate(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacherLike(role);
  const body = normalizeBody(req.body);
  const timestamp = nowIso();
  const visibility =
    canReviewSharedBank(role) && body.visibility === 'shared' ? 'shared' : 'private';
  const payload = {
    ownerUid: uid,
    ownerName: '',
    visibility,
    skill: getString(body, 'skill'),
    responseMode: getString(body, 'responseMode'),
    prompt: getString(body, 'prompt'),
    media: Array.isArray(body.media) ? body.media : [],
    options: Array.isArray(body.options) ? body.options : undefined,
    points: body.points !== undefined ? Number(body.points) : undefined,
    level: getString(body, 'level'),
    tags: sanitizeTags(body.tags),
    sourceAssignmentId: getString(body, 'sourceAssignmentId') || undefined,
    sourceQuestionId: getString(body, 'sourceQuestionId') || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!payload.prompt || !payload.skill || !payload.responseMode) {
    return res.status(400).json({ success: false, error: 'Missing question bank fields' });
  }
  const ref = await db.collection('assessment_question_bank').add(payload);
  return res.status(201).json({ success: true, id: ref.id, data: { id: ref.id, ...payload } });
}

export async function handleQuestionBankSubmitReview(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacherLike(role);
  const body = normalizeBody(req.body);
  const id = getString(body, 'id');
  if (!id) return res.status(400).json({ success: false, error: 'Missing bank item id' });
  const { ref } = await getOwnedBankItem(db, 'assessment_question_bank', id, uid, role);
  await ref.update({ visibility: 'pending_review', updatedAt: nowIso(), reviewNote: '' });
  return res.status(200).json({ success: true, id });
}

export async function handleQuestionBankReview(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!canReviewSharedBank(role))
    return res.status(403).json({ success: false, error: 'Review role required' });
  const body = normalizeBody(req.body);
  const id = getString(body, 'id');
  const decision = getString(body, 'decision');
  if (!id || (decision !== 'approve' && decision !== 'reject' && decision !== 'archive')) {
    return res.status(400).json({ success: false, error: 'Invalid review decision' });
  }
  const ref = db.collection('assessment_question_bank').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Bank item not found' });
  const visibility =
    decision === 'approve' ? 'shared' : decision === 'archive' ? 'archived' : 'private';
  await ref.update({
    visibility,
    reviewedByUid: uid,
    reviewedAt: nowIso(),
    reviewNote: getString(body, 'reviewNote'),
    updatedAt: nowIso(),
  });
  return res.status(200).json({ success: true, id });
}

export async function handleQuestionBankSearch(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacherLike(role);
  const requestedVisibility = getQueryString(req, 'visibility');
  const query = getQueryString(req, 'q').trim().toLowerCase();
  const skill = getQueryString(req, 'skill');
  const responseMode = getQueryString(req, 'responseMode');
  if (requestedVisibility && !isBankVisibility(requestedVisibility)) {
    return res.status(400).json({ success: false, error: 'Invalid bank visibility' });
  }
  const snap = await db
    .collection('assessment_question_bank')
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .get();
  const items = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => isBankVisibility((item as any).visibility))
    .filter((item) => (item as any).visibility !== 'archived')
    .filter((item) => !requestedVisibility || (item as any).visibility === requestedVisibility)
    .filter((item) => !skill || (item as any).skill === skill)
    .filter((item) => !responseMode || (item as any).responseMode === responseMode)
    .filter((item) => matchesBankSearch(item as any, query))
    .filter((item) => canReadBankItem(item as any, uid, role));
  return res.status(200).json({ success: true, data: { items, nextCursor: null } });
}

export async function handleMediaBankCreate(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacherLike(role);
  const body = normalizeBody(req.body);
  const timestamp = nowIso();
  const payload = {
    ownerUid: uid,
    visibility: canReviewSharedBank(role) && body.visibility === 'shared' ? 'shared' : 'private',
    type: getString(body, 'type'),
    source: getString(body, 'source'),
    url: getString(body, 'url'),
    storagePath: getString(body, 'storagePath') || undefined,
    title: getString(body, 'title') || undefined,
    altText: getString(body, 'altText') || undefined,
    transcript: getString(body, 'transcript') || undefined,
    tags: sanitizeTags(body.tags),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!payload.type || !payload.source || !payload.url) {
    return res.status(400).json({ success: false, error: 'Missing media bank fields' });
  }
  const ref = await db.collection('assessment_media_bank').add(payload);
  return res.status(201).json({ success: true, id: ref.id, data: { id: ref.id, ...payload } });
}

export async function handleMediaBankSearch(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  requireTeacherLike(role);
  const requestedVisibility = getQueryString(req, 'visibility');
  const query = getQueryString(req, 'q').trim().toLowerCase();
  const type = getQueryString(req, 'type');
  const source = getQueryString(req, 'source');
  if (requestedVisibility && !isBankVisibility(requestedVisibility)) {
    return res.status(400).json({ success: false, error: 'Invalid bank visibility' });
  }
  const snap = await db
    .collection('assessment_media_bank')
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .get();
  const items = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => isBankVisibility((item as any).visibility))
    .filter((item) => (item as any).visibility !== 'archived')
    .filter((item) => !requestedVisibility || (item as any).visibility === requestedVisibility)
    .filter((item) => !type || (item as any).type === type)
    .filter((item) => !source || (item as any).source === source)
    .filter((item) => matchesBankSearch(item as any, query))
    .filter((item) => canReadBankItem(item as any, uid, role));
  return res.status(200).json({ success: true, data: { items, nextCursor: null } });
}

const MAX_AUTHORING_IMPORT_FILE_SIZE = 4 * 1024 * 1024;

async function parseSingleImportForm(req: ApiRequest): Promise<FormidableFile> {
  const form = formidable({ maxFileSize: MAX_AUTHORING_IMPORT_FILE_SIZE, maxFiles: 1 });
  const [, files] = await form.parse(req);
  const uploadedFile = files.file?.[0];
  if (!uploadedFile) {
    throw Object.assign(new Error('Missing import file'), { statusCode: 400 });
  }
  return uploadedFile;
}

export async function handleAssignmentDraftImportPreview(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  requireTeacher(role);

  const uploadedFile = await parseSingleImportForm(req);
  const buffer = readFileSync(uploadedFile.filepath);
  const preview = await parseAuthoringImportBuffer({
    buffer,
    filename: uploadedFile.originalFilename || 'assignment-import',
    mimetype: uploadedFile.mimetype,
  });

  writeAuditLog(db, {
    userId: uid,
    userRole: role,
    action: 'import',
    collection: 'assignment_authoring_imports',
    documentId: preview.filename,
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write authoring import preview:', err));

  return res.status(200).json({ success: true, data: preview });
}

export const assignmentAuthoringAccess = { canReviewSharedBank };
