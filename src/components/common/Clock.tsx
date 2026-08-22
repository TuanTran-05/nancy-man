import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { format } from 'date-fns';
import { vi, enGB } from 'date-fns/locale';

export const Clock: React.FC = () => {
  const [now, setNow] = useState(new Date());
  const { language } = useLanguage();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Format based on language
  const locale = language === 'vi' ? vi : enGB;
  const dayName = format(now, 'EEEE', { locale });
  const dateStr = format(now, 'dd/MM/yyyy', { locale });
  const timeStr = format(now, 'HH:mm:ss', { locale });

  return (
    <div className="flex flex-col items-end pointer-events-none select-none">
      <div className="bg-slate-50 border border-slate-100/60 dark:bg-slate-800 dark:border-slate-700 rounded-xl px-3 py-1 shadow-sm text-right">
        <div className="text-[10px] font-black text-blue-600 uppercase tracking-wider leading-none mb-0.5">
          {dayName}
        </div>
        <div className="text-[10px] font-bold text-slate-700 dark:text-slate-300 leading-tight">
          {dateStr} • {timeStr}
        </div>
        <div className="text-[8px] font-medium text-slate-400 mt-0.5 flex items-center justify-end">
          <span className="w-1 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mr-1 animate-pulse" />
          {timeZone}
        </div>
      </div>
    </div>
  );
};
