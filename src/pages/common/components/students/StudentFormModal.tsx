import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, User, RefreshCw, Check, Upload, ShieldCheck } from 'lucide-react';
import { ModalPortal } from '../../../../components/common/ModalPortal';
import type { SafeStudent, Class } from '../../../../types';
import { formatClassNameWithTeacher } from '../../../../lib/classes/sortClasses';
import {
  filterStudentClassesBySchedule,
  getStudentClassStartTimes,
} from '../../../../lib/classes/studentClassScheduleFilter';
import { getSuggestedGrade } from '../../../../lib/student/gradeUtils';
import { ApiDateTextInput } from '../../../../components/forms/ApiDateTimeInputs';
import { formatWeeklyClassSchedule } from '../../../../../shared/classSchedule';

interface StudentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingStudent: SafeStudent | null;
  formData: {
    name: string;
    studentId: string;
    dob: string;
    contact: string;
    classId: string;
    faceImage: string;
    faceImageStoragePath: string;
    code: string;
    gender: 'male' | 'female' | 'other' | '';
    grade: string;
  };
  setFormData: React.Dispatch<
    React.SetStateAction<{
      name: string;
      studentId: string;
      dob: string;
      contact: string;
      classId: string;
      faceImage: string;
      faceImageStoragePath: string;
      code: string;
      gender: 'male' | 'female' | 'other' | '';
      grade: string;
    }>
  >;
  classes: Class[];
  sortedClasses: Class[];
  teachers: { uid: string; displayName: string }[];
  isSaving: boolean;
  isCameraActive: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  handleSubmit: (e: React.FormEvent) => void;
  handleModalClose: () => void;
  startCamera: () => void;
  stopCamera: () => void;
  capturePhoto: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fixedClassId?: string;
  t: any;
  tc: any;
}

type StudentClassSelectionProps = Pick<
  StudentFormModalProps,
  'editingStudent' | 'formData' | 'setFormData' | 'classes' | 'sortedClasses' | 'teachers' | 't'
> & { fixedClassId?: string };

function StudentClassSelection({
  editingStudent,
  formData,
  setFormData,
  classes,
  sortedClasses,
  teachers,
  fixedClassId,
  t,
}: StudentClassSelectionProps) {
  const [scheduleDay, setScheduleDay] = useState<number | null>(null);
  const [scheduleStartTime, setScheduleStartTime] = useState<string | null>(null);
  const weekdayLabels: string[] = Array.isArray(t.modal.weekdayLabels) ? t.modal.weekdayLabels : [];

  const startTimeOptions = useMemo(() => getStudentClassStartTimes(sortedClasses), [sortedClasses]);

  const filteredClasses = useMemo(
    () =>
      editingStudent
        ? sortedClasses
        : filterStudentClassesBySchedule(sortedClasses, {
            dayOfWeek: scheduleDay,
            startTime: scheduleStartTime,
          }),
    [editingStudent, scheduleDay, scheduleStartTime, sortedClasses]
  );

  useEffect(() => {
    if (fixedClassId) return;
    if (editingStudent || !formData.classId) return;
    if (scheduleDay === null && scheduleStartTime === null) return;
    if (filteredClasses.some((classInfo) => classInfo.id === formData.classId)) return;

    setFormData((current) =>
      current.classId === formData.classId ? { ...current, classId: '' } : current
    );
  }, [
    fixedClassId,
    editingStudent,
    filteredClasses,
    formData.classId,
    scheduleDay,
    scheduleStartTime,
    setFormData,
  ]);

  const fixedClass =
    !editingStudent && fixedClassId
      ? classes.find((classInfo) => classInfo.id === fixedClassId)
      : undefined;

  if (fixedClass) {
    return (
      <div>
        <span id="student-class-label" className="block text-sm font-medium text-slate-700 mb-1">
          {t.modal.classLabel}
        </span>
        <div
          aria-labelledby="student-class-label"
          className="w-full px-4 py-2 bg-slate-50 border border-border-default rounded-xl text-slate-700"
        >
          {fixedClass.name}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="student-class" className="block text-sm font-medium text-slate-700 mb-1">
        {t.modal.classLabel}
      </label>
      {!editingStudent && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="student-class-weekday-filter"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              {t.modal.scheduleDayFilter}
            </label>
            <select
              id="student-class-weekday-filter"
              value={scheduleDay ?? ''}
              onChange={(event) =>
                setScheduleDay(event.target.value === '' ? null : Number(event.target.value))
              }
              className="w-full rounded-xl border border-border-default bg-page px-3 py-2 outline-none transition-all focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t.modal.allScheduleDays}</option>
              {weekdayLabels.map((label, dayOfWeek) => (
                <option key={dayOfWeek} value={dayOfWeek}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="student-class-time-filter"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              {t.modal.scheduleStartTimeFilter}
            </label>
            <select
              id="student-class-time-filter"
              value={scheduleStartTime ?? ''}
              onChange={(event) => setScheduleStartTime(event.target.value || null)}
              className="w-full rounded-xl border border-border-default bg-page px-3 py-2 outline-none transition-all focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t.modal.allStartTimes}</option>
              {startTimeOptions.map((startTime) => (
                <option key={startTime} value={startTime}>
                  {startTime}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <select
        id="student-class"
        required
        value={formData.classId}
        onChange={(event) => {
          const classId = event.target.value;
          const classGrade = classes.find((classInfo) => classInfo.id === classId)?.grade;
          setFormData({
            ...formData,
            classId,
            grade: classGrade ? String(classGrade) : formData.grade,
          });
        }}
        className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
      >
        {filteredClasses.length === 0 && !editingStudent ? (
          <option value="" disabled>
            {t.modal.noMatchingClasses}
          </option>
        ) : (
          <>
            <option value="">{t.modal.selectClass}</option>
            {filteredClasses.map((classInfo) => {
              const displayName = formatClassNameWithTeacher(classInfo, teachers);
              const scheduleLabel = editingStudent
                ? ''
                : formatWeeklyClassSchedule(
                    classInfo,
                    weekdayLabels.length > 0 ? weekdayLabels : undefined
                  );

              return (
                <option key={classInfo.id} value={classInfo.id}>
                  {scheduleLabel ? `${displayName} - ${scheduleLabel}` : displayName}
                </option>
              );
            })}
          </>
        )}
      </select>
    </div>
  );
}

export const StudentFormModal: React.FC<StudentFormModalProps> = ({
  isOpen,
  editingStudent,
  formData,
  setFormData,
  classes,
  sortedClasses,
  teachers,
  isSaving,
  isCameraActive,
  videoRef,
  handleSubmit,
  handleModalClose,
  startCamera,
  stopCamera,
  capturePhoto,
  handleFileUpload,
  fixedClassId,
  t,
  tc,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-hidden="true"
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-6 border-b border-border-light flex items-center justify-between shrink-0">
                <h2 className="text-xl font-bold text-heading">
                  {editingStudent ? t.modal.editTitle : t.modal.addTitle}
                </h2>
                <button
                  type="button"
                  aria-label={t.close}
                  onClick={handleModalClose}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-muted" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
                {/* Face Data Section */}
                <div className="flex flex-col items-center justify-center p-4 bg-page rounded-2xl border border-border-default mb-4">
                  <p className="text-sm font-bold text-slate-700 mb-3 flex items-center">
                    <Camera className="w-4 h-4 mr-2" />
                    {t.modal.faceLabel}
                  </p>

                  <div className="relative w-32 h-32 rounded-full overflow-hidden bg-slate-200 border-4 border-white shadow-md dark:shadow-black/20 group">
                    {isCameraActive ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover scale-x-[-1]"
                      />
                    ) : formData.faceImage ? (
                      <img
                        src={formData.faceImage}
                        alt="Captured Face"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-subtle">
                        <User className="w-12 h-12" />
                      </div>
                    )}

                    {!isCameraActive && (
                      <button
                        type="button"
                        onClick={startCamera}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                      >
                        <RefreshCw className="w-6 h-6" />
                      </button>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {isCameraActive ? (
                      <>
                        <button
                          type="button"
                          onClick={capturePhoto}
                          className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors flex items-center"
                        >
                          <Check className="w-3 h-3 mr-1" />
                          {t.modal.takePhoto}
                        </button>
                        <button
                          type="button"
                          onClick={stopCamera}
                          className="px-4 py-1.5 bg-slate-600 text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-colors"
                        >
                          {tc.cancel}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={startCamera}
                          className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors flex items-center"
                        >
                          <Camera className="w-3 h-3 mr-1" />
                          {formData.faceImage ? t.messages.cameraRetake : t.modal.openCamera}
                        </button>
                        <label className="px-4 py-1.5 bg-surface border border-border-default text-slate-600 text-xs font-bold rounded-lg hover:bg-hover transition-colors flex items-center cursor-pointer">
                          <Upload className="w-3 h-3 mr-1" />
                          {t.messages.cameraUpload}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileUpload}
                          />
                        </label>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-subtle mt-2">{t.messages.cameraReq}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t.modal.nameLabel}
                    </label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value.toUpperCase() })
                      }
                      className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder={t.modal.namePlaceholder}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t.genderLabel}
                    </label>
                    <select
                      required
                      value={formData.gender}
                      onChange={(e) => setFormData({ ...formData, gender: e.target.value as any })}
                      className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    >
                      <option value="">{t.selectGender}</option>
                      <option value="male">{t.male}</option>
                      <option value="female">{t.female}</option>
                      <option value="other">{t.other}</option>
                    </select>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t.modal.gradeLabel}
                    </label>
                    <select
                      value={formData.grade}
                      onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                      className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    >
                      <option value="">{t.modal.selectGrade}</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                        <option key={g} value={g}>
                          {t.gradeOption.replace('{grade}', String(g))}
                        </option>
                      ))}
                    </select>
                    {formData.dob &&
                      (() => {
                        const sg = getSuggestedGrade(formData.dob);
                        return sg && formData.grade && Number(formData.grade) !== sg;
                      })() && (
                        <p className="text-[10px] text-amber-600 mt-1">
                          {t.gradeSuggestion.replace(
                            '{grade}',
                            String(getSuggestedGrade(formData.dob))
                          )}
                        </p>
                      )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t.modal.idLabel}
                    </label>
                    {editingStudent ? (
                      <input
                        type="text"
                        value={formData.studentId}
                        readOnly
                        className="w-full px-4 py-2 bg-slate-100 dark:bg-slate-800 border border-border-default rounded-xl outline-none font-mono text-muted cursor-not-allowed"
                      />
                    ) : (
                      <div className="w-full px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl font-mono text-emerald-700 dark:text-emerald-400 text-sm flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <span>{t.autoGeneratedId}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <ApiDateTextInput
                      label={t.modal.dobLabel}
                      required
                      value={formData.dob}
                      onChange={(newDob) => {
                        const suggested = getSuggestedGrade(newDob);
                        setFormData({
                          ...formData,
                          dob: newDob,
                          grade: formData.grade || (suggested ? String(suggested) : ''),
                        });
                      }}
                      inputClassName="w-full px-4 py-2 bg-page border-border-default rounded-xl focus:ring-blue-500"
                    />
                    <p className="text-[10px] text-subtle mt-1">
                      {t.messages.studentInfoLoginDesc}
                    </p>
                  </div>
                  <StudentClassSelection
                    editingStudent={editingStudent}
                    formData={formData}
                    setFormData={setFormData}
                    classes={classes}
                    sortedClasses={sortedClasses}
                    teachers={teachers}
                    fixedClassId={fixedClassId}
                    t={t}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t.modal.contactLabel}
                  </label>
                  <input
                    required
                    type="text"
                    value={formData.contact}
                    onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                    className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder={t.modal.contactPlaceholder}
                  />
                  <p className="text-[10px] text-subtle mt-1">{t.contactSmsHint}</p>
                </div>
                <div className="pt-4 flex space-x-3">
                  <button
                    type="button"
                    onClick={handleModalClose}
                    className="flex-1 px-4 py-2 border border-border-default text-slate-600 font-medium rounded-xl hover:bg-hover transition-colors"
                  >
                    {tc.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 disabled:opacity-50 flex items-center justify-center"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        <span>{t.saving}</span>
                      </>
                    ) : editingStudent ? (
                      t.saveChanges
                    ) : (
                      t.modal.save
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        </ModalPortal>
      )}
    </AnimatePresence>
  );
};
