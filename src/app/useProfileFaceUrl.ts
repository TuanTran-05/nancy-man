import React from 'react';
import type { UserProfile } from '../types';
import { isStudentFaceStoragePath, resolveStudentFaceUrl } from '../lib/student/faceImage';

export const useProfileFaceUrl = (profile: UserProfile | null) => {
  const [resolvedUrl, setResolvedUrl] = React.useState<{ key: string; url: string } | null>(null);

  const directUrl = profile?.faceImage || '';
  const storagePath =
    profile?.faceImageStoragePath || (isStudentFaceStoragePath(directUrl) ? directUrl : '');
  const cacheKey = storagePath && profile?.studentId ? `${profile.studentId}:${storagePath}` : '';
  const fallbackUrl = storagePath || isStudentFaceStoragePath(directUrl) ? '' : directUrl;

  React.useEffect(() => {
    if (!cacheKey || !profile?.studentId) return;

    let cancelled = false;
    resolveStudentFaceUrl(profile.studentId, directUrl, profile.faceImageStoragePath)
      .then((resolvedUrl) => {
        if (!cancelled) setResolvedUrl({ key: cacheKey, url: resolvedUrl });
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, directUrl, profile?.faceImageStoragePath, profile?.studentId]);

  return cacheKey ? (resolvedUrl?.key === cacheKey ? resolvedUrl.url : '') : fallbackUrl;
};
