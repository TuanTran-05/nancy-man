export type PrintRequestStatus = 'pending' | 'printed' | 'completed' | 'rejected' | 'cancelled';

export const PRINT_REQUEST_ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'jpg',
  'jpeg',
  'png',
] as const;

export type PrintRequestFileType = (typeof PRINT_REQUEST_ALLOWED_EXTENSIONS)[number];

export const FILE_TYPE_ERROR =
  'Invalid file type. Allowed: PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, JPG/PNG.';

export const PRINT_REQUEST_ALLOWED_MIME_TYPES: Record<PrintRequestFileType, string[]> = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
};

export function getPrintRequestDateKey(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizePrintRequestDateKey(explicitDate: string, fallbackIso: string): string {
  const trimmed = explicitDate.trim();
  if (trimmed) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return '';
    const [year, month, day] = trimmed.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return trimmed;
    }
    return '';
  }
  return getPrintRequestDateKey(fallbackIso);
}

export function normalizePrintQuantity(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value || '').trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5000) return null;
  return parsed;
}

export function getPrintRequestFileType(filename: string): PrintRequestFileType | null {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return PRINT_REQUEST_ALLOWED_EXTENSIONS.includes(ext as PrintRequestFileType)
    ? (ext as PrintRequestFileType)
    : null;
}

export function validatePrintRequestFile(
  filename: string,
  mimeType: string
): { fileType: PrintRequestFileType; mimeType: string } | { error: string } {
  const fileType = getPrintRequestFileType(filename);
  if (!fileType) return { error: FILE_TYPE_ERROR };
  const allowed = PRINT_REQUEST_ALLOWED_MIME_TYPES[fileType];
  if (!allowed.includes(mimeType)) return { error: FILE_TYPE_ERROR };
  return { fileType, mimeType };
}

export function canTransitionPrintRequestStatus(
  current: PrintRequestStatus,
  next: PrintRequestStatus
): boolean {
  if (current === 'pending') {
    return next === 'printed' || next === 'rejected' || next === 'cancelled';
  }
  if (current === 'printed') return next === 'completed';
  return false;
}
