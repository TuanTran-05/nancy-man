import React from 'react';
import { ArrowLeftRight, ClipboardCheck } from 'lucide-react';
import { SubstituteRequest } from '../../types';
import { useLanguage } from '../../lib/i18n/useLanguage';

interface Props {
  request: SubstituteRequest;
  onGoToAttendance?: () => void;
}

export function SubstituteClassBanner({ request, onGoToAttendance }: Props) {
  const { t } = useLanguage();
  const T = t.substitute;

  return (
    <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-4 text-white shadow-lg">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
          <ArrowLeftRight className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">
            {T.todaySubstitute
              .replace('{className}', request.className)
              .replace('{teacherName}', request.requestingTeacherName)}
          </p>
          {request.reason && (
            <p className="text-xs text-blue-100 mt-0.5 truncate">
              {T.reason}: {request.reason}
            </p>
          )}
        </div>
        {onGoToAttendance && (
          <button
            onClick={onGoToAttendance}
            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            <ClipboardCheck className="w-4 h-4" />
            {T.startAttendance}
          </button>
        )}
      </div>
    </div>
  );
}
