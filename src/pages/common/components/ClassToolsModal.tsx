import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserCheck, Shuffle, Users } from 'lucide-react';
import { auth } from '../../../lib/auth/sessionAuth';
import { Student, Class } from '../../../types';
import { readChannel } from '../../../lib/api/readApi';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import { ModalPortal } from '../../../components/common/ModalPortal';
import { cn } from '../../../lib/core/utils';
import { FRONTEND_LARGE_COLLECTION_LIMIT } from '../../../lib/api/readLimits';

interface ClassToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  classData: Class;
  isAdmin: boolean;
}

export function ClassToolsModal({ isOpen, onClose, classData, isAdmin }: ClassToolsModalProps) {
  const { language, t: translationsObj } = useLanguage();
  const t = translationsObj.classesPage;

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'picker' | 'teams'>('picker');
  const [pickedStudent, setPickedStudent] = useState<Student | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [numTeams, setNumTeams] = useState(2);
  const [teams, setTeams] = useState<Student[][]>([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    let cancelled = false;
    readChannel<{ students: Student[] }>('students', {
      view: 'academic',
      classId: classData.id,
      limit: FRONTEND_LARGE_COLLECTION_LIMIT,
    })
      .then((data) => {
        if (cancelled) return;
        setStudents(data.students || []);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error fetching students for tools:', error);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [classData.id, isAdmin]);

  const pickRandom = () => {
    if (students.length === 0) return;
    setIsPicking(true);
    setPickedStudent(null);

    let count = 0;
    const interval = setInterval(() => {
      setPickedStudent(students[Math.floor(Math.random() * students.length)]);
      count++;
      if (count > 20) {
        clearInterval(interval);
        setIsPicking(false);
      }
    }, 100);
  };

  const generateTeams = () => {
    if (students.length === 0) return;
    const shuffled = [...students].sort(() => Math.random() - 0.5);
    const newTeams: Student[][] = Array.from({ length: numTeams }, () => []);

    shuffled.forEach((student, index) => {
      newTeams[index % numTeams].push(student);
    });

    setTeams(newTeams);
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        >
          <div className="p-6 border-b border-border-light flex items-center justify-between bg-blue-600 text-white shrink-0">
            <div>
              <h2 className="text-xl font-bold">
                {t.classTools}: {classData.name}
              </h2>
              <p className="text-blue-100 text-sm">
                {students.length} {t.studentsEnrolled}
              </p>
            </div>
            <button
              type="button"
              aria-label={t.close}
              onClick={onClose}
              className="p-2 hover:bg-surface/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex border-b border-border-light shrink-0">
            <button
              onClick={() => setActiveTab('picker')}
              className={cn(
                'flex-1 py-4 text-sm font-bold flex items-center justify-center space-x-2 border-b-2 transition-colors',
                activeTab === 'picker'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-muted hover:text-slate-700'
              )}
            >
              <UserCheck className="w-4 h-4" />
              <span>{t.randomPicker}</span>
            </button>
            <button
              onClick={() => setActiveTab('teams')}
              className={cn(
                'flex-1 py-4 text-sm font-bold flex items-center justify-center space-x-2 border-b-2 transition-colors',
                activeTab === 'teams'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-muted hover:text-slate-700'
              )}
            >
              <Shuffle className="w-4 h-4" />
              <span>{t.teamGen}</span>
            </button>
          </div>

          <div className="p-8 min-h-[300px] flex flex-col items-center justify-center">
            {loading ? (
              <div className="flex flex-col items-center space-y-4">
                <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-muted font-medium">{t.loadingStudents}</p>
              </div>
            ) : students.length === 0 ? (
              <div className="text-center text-subtle">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>{t.noStudents}</p>
                <p className="text-xs mt-2">{t.noStudentsAdd}</p>
              </div>
            ) : activeTab === 'picker' ? (
              <div className="text-center space-y-8 w-full">
                <div className="h-32 flex items-center justify-center">
                  <AnimatePresence mode="wait">
                    {pickedStudent ? (
                      <motion.div
                        key={pickedStudent.id}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="text-center"
                      >
                        <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4 border-4 border-white shadow-lg">
                          {pickedStudent.name[0].toUpperCase()}
                        </div>
                        <h3 className="text-3xl font-black text-heading">{pickedStudent.name}</h3>
                        <p className="text-muted font-medium">{pickedStudent.studentId}</p>
                      </motion.div>
                    ) : (
                      <div className="text-slate-300 text-lg font-medium italic">
                        {isPicking ? t.shuffling : t.readyPick}
                      </div>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  onClick={pickRandom}
                  disabled={isPicking}
                  className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-95 disabled:opacity-50"
                >
                  {isPicking ? t.picking : t.pickRandomStudent}
                </button>
              </div>
            ) : (
              <div className="w-full space-y-6">
                <div className="flex items-center justify-between bg-page p-4 rounded-xl border border-border-default">
                  <div className="flex items-center space-x-4">
                    <span className="text-sm font-bold text-slate-700">{t.numTeams}</span>
                    <input
                      type="number"
                      min="2"
                      max={Math.max(2, students.length)}
                      value={numTeams}
                      onChange={(e) => setNumTeams(parseInt(e.target.value))}
                      className="w-16 px-2 py-1 border border-slate-300 rounded-lg text-center font-bold"
                    />
                  </div>
                  <button
                    onClick={generateTeams}
                    className="bg-emerald-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95"
                  >
                    {t.generate}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2">
                  {teams.map((team, idx) => (
                    <div
                      key={idx}
                      className="bg-surface border border-border-default rounded-xl overflow-hidden shadow-sm dark:shadow-black/20"
                    >
                      <div className="bg-page px-4 py-2 border-b border-border-default flex justify-between items-center">
                        <span className="font-bold text-slate-700">
                          {t.team} {idx + 1}
                        </span>
                        <span className="text-xs font-medium text-subtle">
                          {team.length} {t.members}
                        </span>
                      </div>
                      <div className="p-3 space-y-2">
                        {team.map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center space-x-2 text-sm text-slate-600"
                          >
                            <div className="w-6 h-6 bg-blue-50 dark:bg-blue-500/10 text-blue-600 rounded-full flex items-center justify-center text-[10px] font-bold">
                              {s.name[0].toUpperCase()}
                            </div>
                            <span>{s.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {teams.length === 0 && (
                    <div className="col-span-full text-center py-12 text-subtle italic">
                      {t.configureTeams}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
