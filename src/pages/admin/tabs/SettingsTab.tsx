import React from 'react';
import { motion } from 'framer-motion';
import { Database, Loader2, X, Download, RefreshCw } from 'lucide-react';
import { formatVN } from '../../../lib/core/utils';
import { translations } from '../../../lib/i18n/translations';
import { ZaloOAStatusPanel } from '../../../components/zalo/ZaloOAStatusPanel';
import { ApiDateTextInput } from '../../../components/forms/ApiDateTimeInputs';

interface SettingsTabProps {
  language: keyof typeof translations;
  t: any;
  ap: any;
  isAdmin: boolean;
  newHoliday: string;
  setNewHoliday: (val: string) => void;
  holidayActionLoading: string | null;
  holidayDates: string[];
  isExporting: boolean;
  isStandardizing: boolean;
  handleAddHoliday: () => Promise<void>;
  handleRemoveHoliday: (date: string) => Promise<void>;
  handleExportExcel: () => Promise<void>;
  handleExportSQL: () => Promise<void>;
  handleStandardizeStudentIds: () => Promise<void>;
  handleStandardizeTeacherIds: () => Promise<void>;
}

export function SettingsTab({
  language,
  t,
  ap,
  isAdmin,
  newHoliday,
  setNewHoliday,
  holidayActionLoading,
  holidayDates,
  isExporting,
  isStandardizing,
  handleAddHoliday,
  handleRemoveHoliday,
  handleExportExcel,
  handleExportSQL,
  handleStandardizeStudentIds,
  handleStandardizeTeacherIds,
}: SettingsTabProps) {
  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-surface rounded-2xl shadow-sm dark:shadow-black/20 border border-border-default overflow-hidden"
    >
      <div className="p-6 border-b border-border-light">
        <h2 className="text-lg font-bold text-heading flex items-center">
          <Database className="w-5 h-5 mr-2 text-blue-500" />
          {t.settingsTab.title}
        </h2>
        <p className="text-sm text-slate-500 mt-1">{t.settingsTab.desc}</p>
      </div>
      <div className="p-6 space-y-6">
        <div className="bg-page rounded-xl border border-border-light p-4">
          <div className="mb-4">
            <h3 className="font-bold text-heading">{ap.holidayManagement}</h3>
            <p className="text-sm text-slate-500 mt-1">{ap.holidayAutoShift}</p>
          </div>
          <div className="flex flex-col space-y-3">
            <div className="flex items-center space-x-2">
              <ApiDateTextInput
                label={ap.addDate}
                hideLabel
                value={newHoliday}
                onChange={setNewHoliday}
                disabled={holidayActionLoading !== null}
                inputClassName="w-48 px-4 py-2 bg-surface border-border-default rounded-xl focus:ring-blue-500"
              />
              <button
                onClick={handleAddHoliday}
                disabled={holidayActionLoading !== null || !newHoliday}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {holidayActionLoading === 'add' && <Loader2 className="h-4 w-4 animate-spin" />}
                {holidayActionLoading === 'add' ? ap.adding : ap.addDate}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {holidayDates.map((d) => (
                <div
                  key={d}
                  className="flex items-center space-x-1 bg-surface border border-border-default px-3 py-1.5 rounded-lg shadow-sm text-sm font-medium"
                >
                  <span>{formatVN(d, 'dd/MM/yyyy')}</span>
                  <button
                    onClick={() => handleRemoveHoliday(d)}
                    disabled={holidayActionLoading !== null}
                    className="text-red-500 hover:text-red-700 p-1 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {holidayActionLoading === d ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {isAdmin && (
          <>
            {/* Zalo OA Configuration */}
            <div className="bg-page rounded-xl border border-border-light p-4">
              <div className="mb-4">
                <h3 className="font-bold text-heading flex items-center gap-2">
                  <span className="text-blue-500">💬</span>
                  {ap.zaloOAConfig}
                </h3>
                <p className="text-sm text-slate-500 mt-1">{ap.absenceNotifDesc}</p>
              </div>
              <ZaloOAStatusPanel language={language} />
            </div>

            <div className="flex items-center justify-between p-4 bg-page rounded-xl border border-border-light">
              <div>
                <h3 className="font-bold text-heading">{t.settingsTab.exportTitle}</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {t.settingsTab.exportDesc} (Excel/SQL)
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleExportExcel}
                  disabled={isExporting}
                  className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {isExporting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                  <span>{ap.exportExcel}</span>
                </button>
                <button
                  onClick={handleExportSQL}
                  disabled={isExporting}
                  className="flex items-center space-x-2 bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-sm shadow-emerald-200 disabled:opacity-50"
                >
                  {isExporting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                  <span>{t.settingsTab.exportAction} (SQL)</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-page rounded-xl border border-border-light">
              <div>
                <h3 className="font-bold text-heading">{ap.standardizeStudentIds}</h3>
                <p className="text-sm text-slate-500 mt-1">{ap.standardizeStudentsDesc}</p>
              </div>
              <button
                onClick={handleStandardizeStudentIds}
                disabled={isStandardizing}
                className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200 disabled:opacity-50"
              >
                {isStandardizing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <RefreshCw className="w-5 h-5" />
                )}
                <span>{ap.start}</span>
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-page rounded-xl border border-border-light">
              <div>
                <h3 className="font-bold text-heading">{ap.standardizeTeacherIds}</h3>
                <p className="text-sm text-slate-500 mt-1">{ap.standardizeTeachersDesc}</p>
              </div>
              <button
                onClick={handleStandardizeTeacherIds}
                disabled={isStandardizing}
                className="flex items-center space-x-2 bg-slate-800 text-white px-4 py-2 rounded-xl font-medium hover:bg-slate-900 transition-colors shadow-sm shadow-slate-200 disabled:opacity-50"
              >
                {isStandardizing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <RefreshCw className="w-5 h-5" />
                )}
                <span>{ap.start}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
