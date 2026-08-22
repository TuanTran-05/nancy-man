type LifecycleRecord = Record<string, unknown> | null | undefined;

export function isSoftDeletedRecord(data: LifecycleRecord): boolean {
  return data?.isDeleted === true;
}

export function isVoidedRecord(data: LifecycleRecord): boolean {
  return data?.isVoided === true;
}

export function isActiveAcademicRecord(data: LifecycleRecord): boolean {
  return !isSoftDeletedRecord(data) && !isVoidedRecord(data);
}

export function isArchivedRecord(data: LifecycleRecord): boolean {
  return data?.studentLifecycle === 'archived' || data?.status === 'archived';
}
