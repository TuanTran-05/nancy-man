const API_BASE = '/api/v1/edu';

async function getAuthHeaders(): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
}

interface GenerateOptions {
  prompt?: string;
  contents?: unknown[];
  model?: string;
  generationConfig?: Record<string, unknown>;
}

/**
 * Call the server-side Gemini API proxy.
 */
export async function generateAIContent(options: GenerateOptions): Promise<string> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/evaluation-generate-ai`, {
    method: 'POST',
    headers,
    body: JSON.stringify(options),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || `AI request failed (${response.status})`);
  }
  return data.text;
}
