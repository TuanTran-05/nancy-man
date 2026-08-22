import type { AuditLogEntry } from '../../types';

export interface AuditUserLookup {
  displayName?: string;
  email?: string;
  role?: string;
}

export function getAuditLookupName(user?: AuditUserLookup): string {
  return (user?.displayName || user?.email || '').trim();
}

export function getUserParts(
  id: string | undefined,
  userMap: Record<string, AuditUserLookup>,
  fallbackName?: string,
  fallbackRole?: string
): { id: string; name: string; role: string } {
  const user = id ? userMap[id] : undefined;
  const lookupName = getAuditLookupName(user);
  const rawFallbackName = (fallbackName || '').trim();
  const name =
    rawFallbackName && rawFallbackName !== id ? rawFallbackName : lookupName || rawFallbackName;
  return {
    id: id || '',
    name,
    role: fallbackRole || user?.role || '',
  };
}

export function getAuditActorParts(
  log: AuditLogEntry,
  userMap: Record<string, AuditUserLookup>
): { name: string; role: string; id: string } {
  const user = log.userId ? userMap[log.userId] : undefined;
  const lookupName = getAuditLookupName(user);
  const fallbackName = (log.userName || '').trim();
  const name =
    fallbackName && fallbackName !== log.userId ? fallbackName : lookupName || fallbackName;

  return {
    id: log.userId || '',
    name,
    role:
      log.userRole && log.userRole !== 'unknown' ? log.userRole : user?.role || log.userRole || '',
  };
}

export function formatUserLabel(
  id: string | undefined,
  userMap: Record<string, AuditUserLookup>,
  fallbackName?: string
): string {
  const user = getUserParts(id, userMap, fallbackName);
  if (user.name && user.id && user.name !== user.id) return `${user.name} (ID: ${user.id})`;
  return user.name || user.id || '-';
}

export function getAuditInitial(actor: { name: string; id: string }): string {
  return (actor.name || actor.id || '?').trim()[0]?.toUpperCase() || '?';
}
