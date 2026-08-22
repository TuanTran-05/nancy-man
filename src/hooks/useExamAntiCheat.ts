import { useState, useEffect, useCallback, MutableRefObject } from 'react';
import { ExamMetrics } from '../types';

export function useExamAntiCheat(isActive: boolean, suspendRef: MutableRefObject<boolean>) {
  const [metrics, setMetrics] = useState<ExamMetrics>({
    tabSwitchCount: 0,
    focusLossCount: 0,
    fullscreenExitCount: 0,
    sessionStartedAt: null,
  });

  useEffect(() => {
    if (!isActive) return;

    setMetrics({
      tabSwitchCount: 0,
      focusLossCount: 0,
      fullscreenExitCount: 0,
      sessionStartedAt: new Date().toISOString(),
    });

    const handleVisibilityChange = () => {
      if (suspendRef.current) return;
      if (document.visibilityState === 'hidden') {
        setMetrics((prev) => ({ ...prev, tabSwitchCount: prev.tabSwitchCount + 1 }));
      }
    };

    const handleBlur = () => {
      if (suspendRef.current) return;
      setMetrics((prev) => ({ ...prev, focusLossCount: prev.focusLossCount + 1 }));
    };

    const handleFullscreenChange = () => {
      if (suspendRef.current) return;
      if (!document.fullscreenElement) {
        setMetrics((prev) => ({ ...prev, fullscreenExitCount: prev.fullscreenExitCount + 1 }));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isActive, suspendRef]);

  const enterFullscreen = useCallback(async () => {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        return true;
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  }, []);

  const exitFullscreenSafe = useCallback(async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const recordFocusLoss = useCallback(() => {
    setMetrics((prev) => ({ ...prev, focusLossCount: prev.focusLossCount + 1 }));
  }, []);

  const getIntegrityForSubmit = useCallback(() => {
    return {
      tabSwitchCount: metrics.tabSwitchCount,
      focusLossCount: metrics.focusLossCount,
      fullscreenExitCount: metrics.fullscreenExitCount,
      sessionStartedAt: metrics.sessionStartedAt,
    };
  }, [metrics]);

  return { metrics, enterFullscreen, exitFullscreenSafe, recordFocusLoss, getIntegrityForSubmit };
}
