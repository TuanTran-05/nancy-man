const faceUrlCache = new Map<string, Promise<string>>();

export function isStudentFaceStoragePath(value?: string | null): boolean {
  return typeof value === 'string' && value.startsWith('student_faces/');
}

export async function resolveStudentFaceUrl(
  studentId: string,
  faceImage?: string | null,
  faceImageStoragePath?: string | null
): Promise<string> {
  const directUrl = faceImage || '';
  const storagePath =
    faceImageStoragePath || (isStudentFaceStoragePath(directUrl) ? directUrl : '');
  if (!storagePath) return directUrl;

  const cacheKey = `${studentId}:${storagePath}`;
  const existing = faceUrlCache.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const params = new URLSearchParams({ studentId, storagePath });
    const response = await fetch(`/api/v1/knowledge-bank/student-face-image?${params}`, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) {
      let message = 'Failed to load face image';
      try {
        const data = await response.json();
        message = String(data.error || message);
      } catch {
        // Binary endpoint errors should be JSON, but keep a stable fallback.
      }
      throw new Error(message);
    }
    return URL.createObjectURL(await response.blob());
  })();

  faceUrlCache.set(cacheKey, promise);
  promise.catch(() => {
    // Don't let a transient failure (auth-token race, network blip) get
    // permanently stuck in the cache — let the next caller retry the fetch.
    if (faceUrlCache.get(cacheKey) === promise) faceUrlCache.delete(cacheKey);
  });
  return promise;
}
