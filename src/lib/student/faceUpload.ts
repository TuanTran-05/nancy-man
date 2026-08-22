import { isStudentFaceStoragePath } from './faceImage';

export async function uploadStudentFaceImageIfNeeded(
  faceImage: string,
  studentDocId: string,
  classId: string,
  existingStoragePath?: string
): Promise<{ faceImage: string; faceImageStoragePath: string }> {
  if (!faceImage || !faceImage.startsWith('data:image/')) {
    const existingPath =
      existingStoragePath || (isStudentFaceStoragePath(faceImage) ? faceImage : '');
    return {
      faceImage: existingPath || faceImage,
      faceImageStoragePath: existingPath,
    };
  }
  const blob = await fetch(faceImage).then((res) => res.blob());
  const form = new FormData();
  form.append('file', blob, 'face.jpg');
  form.append('studentDocId', studentDocId);
  form.append('classId', classId);

  const response = await fetch('/api/v1/knowledge-bank/upload-student-face', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: form,
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Upload failed');
  }
  const storagePath = String(data.faceImageStoragePath || data.storagePath || '');
  return {
    faceImage: storagePath,
    faceImageStoragePath: storagePath,
  };
}
