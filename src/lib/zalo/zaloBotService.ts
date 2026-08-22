import { ZaloBotStaffRole, ZaloBotLink, ZaloBotMessage } from '../../../shared/zaloBot';

const API_BASE = '/api/v1/zalo-bot';

async function getAuthHeaders(): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
}

async function safeJsonParse(
  response: Response
): Promise<{ data: any | null; error: string | null }> {
  try {
    const text = await response.text();
    try {
      return { data: JSON.parse(text), error: null };
    } catch {
      return {
        data: null,
        error: `Server error (HTTP ${response.status}): ${text.substring(0, 100)}`,
      };
    }
  } catch {
    return { data: null, error: 'Cannot read server response' };
  }
}

export async function getMyZaloBotLink(): Promise<{
  botEnabled: boolean;
  link: Omit<ZaloBotLink, 'chatId'> | null;
}> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/my-link`, { headers });
  const { data, error } = await safeJsonParse(response);
  if (error) throw new Error(error);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function createMyZaloBotLinkCode(): Promise<{ code: string; expiresAt: string }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/create-link-code`, {
    method: 'POST',
    headers,
  });
  const { data, error } = await safeJsonParse(response);
  if (error) throw new Error(error);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function unlinkMyZaloBotChat(): Promise<{ success: true }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/unlink`, {
    method: 'POST',
    headers,
  });
  const { data, error } = await safeJsonParse(response);
  if (error) throw new Error(error);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export type ZaloBotAdminOverview = {
  links: Array<Omit<ZaloBotLink, 'chatId'>>;
  pendingChats: Array<{
    chatIdHash: string;
    displayName: string;
    username?: string;
    avatar?: string;
    lastSeenAt: string;
  }>;
  staff: Array<{
    uid: string;
    displayName: string;
    email: string;
    role: ZaloBotStaffRole;
  }>;
  recentMessages: Array<Omit<ZaloBotMessage, 'contentSnapshot'>>;
};

export async function getZaloBotAdminOverview(): Promise<{
  botEnabled: boolean;
  overview: ZaloBotAdminOverview;
}> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/admin-overview`, { headers });
  const { data, error } = await safeJsonParse(response);
  if (error) throw new Error(error);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function adminLinkZaloBotChat(input: {
  staffId: string;
  chatIdHash: string;
}): Promise<{ success: true }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/admin-link`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  const { data, error } = await safeJsonParse(response);
  if (error) throw new Error(error);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function adminUnlinkZaloBotStaff(staffId: string): Promise<{ success: true }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/admin-unlink`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ staffId }),
  });
  const { data, error } = await safeJsonParse(response);
  if (error) throw new Error(error);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function adminSendZaloBotTest(
  staffId: string
): Promise<{ success: true; messageId: string }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/admin-test`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ staffId }),
  });
  const { data, error } = await safeJsonParse(response);
  if (error) throw new Error(error);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}
