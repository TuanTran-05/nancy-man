export const ZALO_BOT_STAFF_ROLES = ['teacher', 'office', 'admin'] as const;
export const ZALO_BOT_OUTBOX_JOB_TYPE = 'send_zalo_bot_message' as const;
export const ZALO_BOT_SENSITIVE_CONTENT_MARKER = '[SENSITIVE_ADMIN_REPLY]' as const;
export type ZaloBotStaffRole = (typeof ZALO_BOT_STAFF_ROLES)[number];

export type ZaloBotLinkStatus = 'active' | 'disabled' | 'needs_relink';
export type ZaloBotLinkedMethod = 'self' | 'admin';
export type ZaloBotMessageStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'skipped';
export type ZaloBotMessageType = 'daily_digest' | 'link_confirmation' | 'test' | 'chat_reply';

export interface ZaloBotLink {
  staffId: string;
  chatId: string;
  chatIdHash: string;
  displayName: string;
  role: ZaloBotStaffRole;
  status: ZaloBotLinkStatus;
  linkedMethod: ZaloBotLinkedMethod;
  linkedBy?: string;
  linkedAt: string;
  lastSeenAt: string;
  updatedAt: string;
  confirmationStatus?: 'pending' | 'confirmed';
}

export interface ZaloBotMessage {
  id: string;
  staffId: string;
  role: ZaloBotStaffRole;
  chatIdHash: string;
  digestDate: string;
  messageType: ZaloBotMessageType;
  contentSnapshot: string;
  status: ZaloBotMessageStatus;
  attempts: number;
  processingStartedAt?: string;
  lockedBy?: string;
  lastAttemptAt?: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  deliveryAmbiguous?: boolean;
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function isZaloBotStaffRole(value: unknown): value is ZaloBotStaffRole {
  return typeof value === 'string' && ZALO_BOT_STAFF_ROLES.includes(value as any);
}

export function parseZaloBotLinkCommand(text: string): string | null {
  const match = /^\/link\s+([a-z0-9-]{6,16})$/i.exec(text.trim());
  return match ? match[1].replace(/-/g, '').toUpperCase() : null;
}

export function makeZaloBotDailyMessageId(date: string, staffId: string): string {
  return `daily_digest_${date}_${staffId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}
