import type { DocumentStore } from '@/server/db/documentStore.js';
import type { UserContext } from '../../lib/auth/authz.js';
import { getClassGrade } from '../../lib/auth/authz.js';

export type AuthorizedClass = {
  classId: string;
  className: string;
  data: Record<string, unknown>;
};

export type ResolvedZaloBotClass =
  | { kind: 'found'; classId: string; className: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: Array<{ classId: string; className: string }> };

const MAX_AUTHORIZED_CLASSES = 500;
const MAX_AMBIGUOUS_CANDIDATES = 8;

function isOfficeOrAdmin(role: string): boolean {
  return role === 'office' || role === 'admin';
}

function isArchivedByData(data: Record<string, unknown>): boolean {
  return data.status === 'archived';
}

/**
 * Tập lớp mà người hỏi được phép nhìn thấy, dựng TRƯỚC khi dò tên.
 *
 * Đây là chốt chặn phạm vi thứ hai của thiết kế. Vì lớp của người khác không
 * bao giờ vào tập ứng viên, bot trả "không tìm thấy" thay vì "không có quyền",
 * nên không dùng bot để dò được sự tồn tại của lớp người khác.
 */
export async function listAuthorizedClasses(
  db: DocumentStore,
  actor: UserContext
): Promise<AuthorizedClass[]> {
  const query = isOfficeOrAdmin(actor.role)
    ? db.collection('classes').limit(MAX_AUTHORIZED_CLASSES + 1)
    : db
        .collection('classes')
        .where('teacherId', '==', actor.uid)
        .limit(MAX_AUTHORIZED_CLASSES + 1);

  const snap = await query.get();

  // Không được trả một tập ứng viên bị cắt: một lớp hợp lệ nằm sau limit sẽ bị
  // báo sai là not_found. Vượt trần là lỗi vận hành và phải fail closed để
  // chatService gửi câu xin lỗi, đồng thời log cho người vận hành xử lý.
  if (snap.size > MAX_AUTHORIZED_CLASSES) {
    throw new Error(
      `[zaloBotChat] authorized class set exceeds ${MAX_AUTHORIZED_CLASSES} rows`
    );
  }

  return snap.docs
    .map((doc) => ({
      classId: doc.id,
      className: String(doc.data()?.name || ''),
      data: (doc.data() || {}) as Record<string, unknown>,
    }))
    .filter((row) => row.className !== '')
    .filter((row) => actor.role === 'admin' || !isArchivedByData(row.data));
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

/** Bỏ tiền tố "lớp"/"khối"/"grade"/"k" đã chuẩn hóa khỏi gợi ý. */
function stripClassPrefix(normalizedHint: string): string {
  return normalizedHint.replace(/^(?:lop|khoi|grade|k)/, '');
}

/** Gợi ý chỉ gồm một số khối lớp hợp lệ, ví dụ "lớp 7" -> 7. Ngược lại null. */
function parseGradeOnlyHint(normalizedHint: string): number | null {
  const stripped = stripClassPrefix(normalizedHint);
  if (!/^\d{1,2}$/.test(stripped)) return null;
  const grade = Number(stripped);
  return grade >= 1 && grade <= 12 ? grade : null;
}

function toResult(matches: AuthorizedClass[]): ResolvedZaloBotClass {
  if (matches.length === 0) return { kind: 'not_found' };
  if (matches.length === 1) {
    return { kind: 'found', classId: matches[0].classId, className: matches[0].className };
  }
  return {
    kind: 'ambiguous',
    candidates: matches
      .sort((left, right) => left.className.localeCompare(right.className, 'vi'))
      .slice(0, MAX_AMBIGUOUS_CANDIDATES)
      .map((row) => ({ classId: row.classId, className: row.className })),
  };
}

export async function resolveZaloBotClass(
  db: DocumentStore,
  actor: UserContext,
  hint: string | null
): Promise<ResolvedZaloBotClass> {
  const authorized = await listAuthorizedClasses(db, actor);
  if (authorized.length === 0) return { kind: 'not_found' };

  const trimmedHint = (hint || '').trim();
  if (trimmedHint === '') return toResult(authorized);

  const normalizedHint = normalize(trimmedHint);
  if (normalizedHint === '') return toResult(authorized);

  // Tên thật được ưu tiên trước khi diễn giải tiền tố. Nếu không, một lớp như
  // "KET 1" bị coi chữ K đầu là viết tắt của "khối" và biến thành "ET1".
  const rawExact = authorized.filter((row) => normalize(row.className) === normalizedHint);
  if (rawExact.length > 0) return toResult(rawExact);

  // Gợi ý chỉ là khối lớp thì lọc theo khối, không so chuỗi. "7" mà đem so
  // chuỗi sẽ khớp cả "17A" và mọi lớp có chữ số 7 ở bất kỳ đâu.
  const gradeOnly = parseGradeOnlyHint(normalizedHint);
  if (gradeOnly !== null) {
    return toResult(authorized.filter((row) => getClassGrade(row.data) === gradeOnly));
  }

  const stripped = stripClassPrefix(normalizedHint);
  if (stripped === '') return { kind: 'not_found' };

  const exact = authorized.filter((row) => normalize(row.className) === stripped);
  if (exact.length > 0) return toResult(exact);

  const rawPartial = authorized.filter((row) => normalize(row.className).includes(normalizedHint));
  if (rawPartial.length > 0) return toResult(rawPartial);

  const partial = authorized.filter((row) => normalize(row.className).includes(stripped));
  return toResult(partial);
}
