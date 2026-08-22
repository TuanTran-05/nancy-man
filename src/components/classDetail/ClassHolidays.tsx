import React, { useState } from 'react';
import { Calendar, Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiRequest } from '../../lib/api/apiClient';
import { formatVN } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ApiDateTextInput } from '../forms/ApiDateTimeInputs';

interface ClassHolidaysProps {
  classId: string;
  holidays: string[];
  daysOfWeek: number[];
  onHolidaysUpdated: (update: {
    holidays: string[];
    endDate?: string;
    affectedCount?: number;
  }) => void | Promise<void>;
}

type HolidayScope = 'single' | 'teacher-all';

type SaveHolidaysResult = {
  success: boolean;
  holidays?: string[];
  endDate?: string;
  affectedCount?: number;
};

const DAY_NAMES_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ClassHolidays({
  classId,
  holidays,
  daysOfWeek,
  onHolidaysUpdated,
}: ClassHolidaysProps) {
  const { language, t } = useLanguage();
  const [newDate, setNewDate] = useState('');
  const [scope, setScope] = useState<HolidayScope>('single');
  const [saving, setSaving] = useState(false);

  const dayNames = language === 'vi' ? DAY_NAMES_VI : DAY_NAMES_EN;

  const handleAdd = async () => {
    if (!newDate) return;

    const selectedDay = new Date(newDate + 'T00:00:00').getDay();
    if (!daysOfWeek.includes(selectedDay)) {
      toast.error(`${t.classHolidays.addError} (${dayNames[selectedDay]})`);
      return;
    }

    if (scope === 'single' && holidays.includes(newDate)) {
      toast.error(t.classHolidays.addError);
      return;
    }

    setSaving(true);
    try {
      const nextHolidays = [...new Set([...holidays, newDate])].sort();
      const result = await apiRequest<SaveHolidaysResult>('/api/v1/classes/save-holidays', {
        method: 'POST',
        body: {
          classId,
          holidays: [newDate],
          scope,
        },
      });

      toast.success(t.classHolidays.addSuccess);
      setNewDate('');
      await onHolidaysUpdated({
        holidays: result.holidays || nextHolidays,
        endDate: result.endDate,
        affectedCount: result.affectedCount,
      });
    } catch {
      toast.error(t.classHolidays.addError);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (date: string) => {
    setSaving(true);
    try {
      const nextHolidays = holidays.filter((h) => h !== date);
      const result = await apiRequest<SaveHolidaysResult>('/api/v1/classes/save-holidays', {
        method: 'POST',
        body: {
          classId,
          holidays: nextHolidays,
          scope: 'single',
          replace: true,
        },
      });

      toast.success(t.classHolidays.removeSuccess);
      await onHolidaysUpdated({
        holidays: result.holidays || nextHolidays,
        endDate: result.endDate,
      });
    } catch {
      toast.error(t.classHolidays.removeError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-page rounded-xl border border-border-light p-4">
      <h3 className="font-bold text-heading flex items-center gap-2 mb-3">
        <Calendar className="w-5 h-5 text-blue-500" />
        {t.classHolidays.title}
      </h3>

      {holidays.length > 0 ? (
        <div className="space-y-2 mb-4">
          {[...holidays].sort().map((date) => {
            const day = new Date(date + 'T00:00:00').getDay();
            return (
              <div
                key={date}
                className="flex items-center justify-between bg-surface px-3 py-2 rounded-lg border border-border-default"
              >
                <span className="text-sm">
                  {formatVN(date, 'dd/MM/yyyy')} ({dayNames[day]})
                </span>
                <button
                  onClick={() => handleRemove(date)}
                  disabled={saving}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-500 mb-4">{t.classHolidays.noHolidays}</p>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ApiDateTextInput
            label="Holiday date"
            hideLabel
            value={newDate}
            onChange={setNewDate}
            disabled={saving}
            inputClassName="px-3 py-2 bg-surface border-border-default rounded-xl focus:ring-blue-500"
          />
          <select
            aria-label="Holiday scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as HolidayScope)}
            disabled={saving}
            className="px-3 py-2 bg-surface border border-border-default rounded-xl text-sm"
          >
            <option value="single">{t.classHolidays.scopeClass}</option>
            <option value="teacher-all">{t.classHolidays.scopeSchool}</option>
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={saving || !newDate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition disabled:cursor-not-allowed disabled:opacity-50 text-sm"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t.classHolidays.add}
        </button>
      </div>
    </div>
  );
}
