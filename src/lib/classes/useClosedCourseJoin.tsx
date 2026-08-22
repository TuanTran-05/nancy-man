import React, { useCallback, useMemo, useState } from 'react';
import { getVietnamTodayStr } from '../../../shared/classSchedule';
import { resolveClassJoinWindow, type ClassJoinWindow } from '../../../shared/classJoinWindow';
import { ClosedCourseJoinModal } from '../../components/classes/ClosedCourseJoinModal';
import type { Class } from '../../types';

type HeldAction = {
  className: string;
  window: ClassJoinWindow;
  onProceed: (joinedAt?: string) => void | Promise<void>;
};

export function useClosedCourseJoin(): {
  guard: (classData: Class, onProceed: (joinedAt?: string) => void | Promise<void>) => void;
  confirmCurrentTerm: (joinedAt: string) => Promise<void>;
  close: () => void;
  isOpen: boolean;
  modal: React.ReactNode;
} {
  const [held, setHeld] = useState<HeldAction | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const guard = useCallback(
    (classData: Class, onProceed: (joinedAt?: string) => void | Promise<void>) => {
      const window = resolveClassJoinWindow(
        classData as unknown as Record<string, unknown>,
        getVietnamTodayStr()
      );
      if (!window || !window.isClosed) {
        void onProceed(undefined);
        return;
      }
      setHeld({ className: classData.name, window, onProceed });
    },
    []
  );

  const close = useCallback(() => {
    setHeld(null);
    setIsBusy(false);
  }, []);

  const confirmCurrentTerm = useCallback(
    async (joinedAt: string) => {
      if (!held) return;
      setIsBusy(true);
      try {
        await held.onProceed(joinedAt);
      } finally {
        setIsBusy(false);
        setHeld(null);
      }
    },
    [held]
  );

  const modal = useMemo(
    () =>
      held ? (
        <ClosedCourseJoinModal
          isOpen
          className={held.className}
          window={held.window}
          isBusy={isBusy}
          onConfirmCurrentTerm={(joinedAt) => {
            void confirmCurrentTerm(joinedAt);
          }}
          onClose={close}
        />
      ) : null,
    [close, confirmCurrentTerm, held, isBusy]
  );

  return { guard, confirmCurrentTerm, close, isOpen: held !== null, modal };
}
