import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useAnimationControls } from 'framer-motion';
import {
  Play,
  RotateCcw,
  Settings2,
  Users,
  Star,
  X,
  Settings,
  Database,
  Loader2,
  UserMinus,
} from 'lucide-react';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { useAuth } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { Class, Student } from '../../types';
import { readChannel } from '../../lib/api/readApi';
import { ModalPortal } from '../../components/common/ModalPortal';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';
import { FRONTEND_LARGE_COLLECTION_LIMIT } from '../../lib/api/readLimits';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../shared/classVisibility';
import { getLuckyWheelSpinTarget } from './luckyWheelSpin';
import { readClassesData } from '../../lib/api/frontendReadApi';

const COLORS = [
  '#ef4444',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f43f5e',
];

export default function LuckyWheel() {
  const { language, t } = useLanguage();
  const T = t.luckyWheelPage;
  const { profile } = useAuth();

  const [students, setStudents] = useState<string[]>([]);
  const [originalStudents, setOriginalStudents] = useState<string[]>([]);
  const [trollModeRate, setTrollModeRate] = useState<number>(10);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Custom list state
  const [studentsInput, setStudentsInput] = useState('');

  // Local UI state
  const [classes, setClasses] = useState<Class[]>([]);
  const classTeachers = useMemo(
    () => (profile?.uid ? [{ uid: profile.uid, displayName: profile.displayName || 'GV' }] : []),
    [profile?.uid, profile?.displayName]
  );
  const sortedClasses = useMemo(
    () => sortClassesByTeacherThenName(classes, classTeachers),
    [classes, classTeachers]
  );
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [isLoadingData, setIsLoadingData] = useState(false);

  useBodyScrollLock(isSettingsOpen);

  const [isSpinning, setIsSpinning] = useState(false);
  const [winner, setWinner] = useState<{
    id: number;
    name: string;
    isTroll: boolean;
    realWinner: string;
  } | null>(null);

  const wheelControls = useAnimationControls();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentRotationRef = useRef(0);
  const hasFinalWinner = Boolean(winner?.realWinner);
  const hasRemovedStudents = originalStudents.length > students.length;

  useEffect(() => {
    // Keep an audio context ready
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
      audioCtxRef.current = new AudioContext();
    }

    // Fetch teacher's classes
    const fetchClasses = async () => {
      if (!profile || profile.role !== 'teacher') return;
      try {
        const data = await readClassesData();
        const fetchedClasses = (data.classes || []).filter(
          (classRow) => classRow.teacherId === profile.uid
        );
        setClasses(filterClassesForRoleOutsideAdminDashboard(fetchedClasses, profile.role));
      } catch (err) {
        console.error('Error fetching classes:', err);
      }
    };

    fetchClasses();

    return () => {
      audioCtxRef.current?.close();
    };
  }, [profile]);

  // When class changes, load its students through the safe read API.
  useEffect(() => {
    if (!selectedClassId || !profile) return;

    setIsLoadingData(true);
    let cancelled = false;

    readChannel<{ students: Student[] }>('students', {
      view: 'identity',
      classId: selectedClassId,
      limit: FRONTEND_LARGE_COLLECTION_LIMIT,
    })
      .then((data) => {
        if (cancelled) return;
        const names = (data.students || []).map((s) => s.name);
        setStudents(names);
        setOriginalStudents(names);
        setStudentsInput(names.join('\n'));
        setWinner(null);
        currentRotationRef.current = 0;
        wheelControls.set({ rotate: 0 });
        setIsLoadingData(false);
      })
      .catch((error) => {
        console.error('Error loading students:', error);
        setIsLoadingData(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClassId, profile, wheelControls]);

  const playTick = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  };

  const playWin = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';

    // Play a neat chord or trill
    [440, 554.37, 659.25].forEach((freq) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.1);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 2);
      o.start();
      o.stop(ctx.currentTime + 2);
    });
  };

  const playTrollJolt = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.8, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  };

  const spinWheel = async () => {
    if (isSpinning || students.length === 0) return;
    setIsSpinning(true);
    setWinner(null);

    // Re-enable audio context if suspended
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    const N = students.length;
    const spins = 5; // number of full spins

    const isTroll = Math.random() * 100 < trollModeRate;

    // Select index A
    const indexA = Math.floor(Math.random() * N);

    const { sliceAngle, targetRotation: targetRA } = getLuckyWheelSpinTarget({
      currentRotation: currentRotationRef.current,
      selectedIndex: indexA,
      totalSlices: N,
      fullSpins: spins,
    });

    // Hacky tick sound player using setInterval since Framer's onUpdate is heavy
    const tickInterval = setInterval(() => {
      playTick();
    }, 150);

    // Spin to A
    await wheelControls.start({
      rotate: targetRA,
      transition: { duration: 4, ease: [0.2, 0.8, 0.1, 1] },
    });
    currentRotationRef.current = targetRA;

    clearInterval(tickInterval);
    playWin(); // Initial win sound

    if (isTroll) {
      // Wait 0.8s
      setWinner({ id: indexA, name: students[indexA], isTroll: false, realWinner: '' });
      await new Promise((r) => setTimeout(r, 800));

      // Jolt to B
      playTrollJolt();
      // Since R increases (spins clockwise), the next slice to hit top is (A-1).
      const indexB = (indexA - 1 + N) % N;
      const targetRB = targetRA + sliceAngle;

      await wheelControls.start({
        rotate: targetRB,
        transition: { type: 'spring', stiffness: 200, damping: 10 },
      });
      currentRotationRef.current = targetRB;

      setWinner({
        id: indexB,
        name: students[indexA],
        isTroll: true,
        realWinner: students[indexB],
      });
      playWin();
    } else {
      setWinner({
        id: indexA,
        name: students[indexA],
        isTroll: false,
        realWinner: students[indexA],
      });
    }

    setIsSpinning(false);
  };

  const saveSettings = () => {
    const list = studentsInput
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s);
    setStudents(list);
    setOriginalStudents(list);
    setIsSettingsOpen(false);
    setWinner(null);
    currentRotationRef.current = 0;
    wheelControls.set({ rotate: 0 }); // reset wheel
  };

  const continueSpinning = () => {
    setWinner(null);
  };

  const removeSelectedStudent = () => {
    if (!winner || !winner.realWinner || isSpinning) return;

    const nextStudents = students.filter((_, index) => index !== winner.id);
    setStudents(nextStudents);
    setStudentsInput(nextStudents.join('\n'));
    setWinner(null);
    currentRotationRef.current = 0;
    wheelControls.set({ rotate: 0 });
  };

  const resetWheelSession = () => {
    if (isSpinning || !hasRemovedStudents) return;

    setStudents(originalStudents);
    setStudentsInput(originalStudents.join('\n'));
    setWinner(null);
    currentRotationRef.current = 0;
    wheelControls.set({ rotate: 0 });
  };

  const renderWinnerActions = () => (
    <div className="mt-5 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        type="button"
        onClick={removeSelectedStudent}
        disabled={isSpinning}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200/25 bg-rose-500/20 px-4 py-2.5 text-sm font-bold text-rose-50 transition-colors hover:bg-rose-500/30 disabled:opacity-60"
      >
        <UserMinus size={18} />
        <span>{T.removeSelectedStudent || (language === 'vi' ? 'Loại' : 'Remove')}</span>
      </button>
      <button
        type="button"
        onClick={continueSpinning}
        disabled={isSpinning}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
      >
        <RotateCcw size={18} />
        <span>{T.continueSpinning || (language === 'vi' ? 'Tiếp tục' : 'Continue')}</span>
      </button>
    </div>
  );

  // Render SVG wheel slices
  const renderWheel = () => {
    const N = students.length;
    if (N === 0) {
      return (
        <div className="w-full h-full rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
          <p className="text-muted font-medium text-center px-6">
            {T.noStudents}
            <br />
            {T.configureToStart}
          </p>
        </div>
      );
    }

    const sliceAngle = 360 / N;
    const sliceRad = (sliceAngle * Math.PI) / 180;
    const x = 50 * Math.cos(sliceRad);
    const y = 50 * Math.sin(sliceRad);

    // Handling 1 or 2 students specially
    if (N <= 2) {
      return (
        <motion.div
          animate={wheelControls}
          initial={{ rotate: 0 }}
          className="w-full h-full relative transform-gpu will-change-transform"
        >
          <svg viewBox="-50 -50 100 100" className="w-full h-full drop-shadow-xl overflow-visible">
            {N === 1 ? (
              <g>
                <circle cx="0" cy="0" r="50" fill={COLORS[0]} />
                <text
                  fill="#ffffff"
                  fontSize="4.5"
                  fontFamily="sans-serif"
                  fontWeight="bold"
                  dominantBaseline="central"
                  textAnchor="middle"
                >
                  {students[0]}
                </text>
              </g>
            ) : (
              // 2 students
              <>
                <path d="M 0 0 L 50 0 A 50 50 0 0 1 -50 0 Z" fill={COLORS[0]} />
                <path d="M 0 0 L -50 0 A 50 50 0 0 1 50 0 Z" fill={COLORS[1]} />
                <text
                  fill="#ffffff"
                  fontSize="4.5"
                  fontFamily="sans-serif"
                  fontWeight="bold"
                  x="25"
                  y="15"
                  textAnchor="middle"
                  transform="rotate(45, 25, 15)"
                >
                  {students[0]}
                </text>
                <text
                  fill="#ffffff"
                  fontSize="4.5"
                  fontFamily="sans-serif"
                  fontWeight="bold"
                  x="-25"
                  y="-15"
                  textAnchor="middle"
                  transform="rotate(45, -25, -15)"
                >
                  {students[1]}
                </text>
              </>
            )}
            <circle cx="0" cy="0" r="10" fill="#1e293b" stroke="#334155" strokeWidth="2" />
            <circle cx="0" cy="0" r="5" fill="#f59e0b" />
          </svg>
        </motion.div>
      );
    }

    const largeArcFlag = sliceAngle > 180 ? 1 : 0;
    const pathD = `M 0 0 L 50 0 A 50 50 0 ${largeArcFlag} 1 ${x} ${y} Z`;

    const fontSize = N > 25 ? '2.5' : N > 15 ? '3.5' : '4.5';

    return (
      <motion.div
        animate={wheelControls}
        initial={{ rotate: 0 }}
        className="w-full h-full transform-gpu will-change-transform"
      >
        <svg viewBox="-50 -50 100 100" className="w-full h-full drop-shadow-xl overflow-visible">
          {students.map((stu, i) => (
            <g key={i} transform={`rotate(${i * sliceAngle})`}>
              <path
                d={pathD}
                fill={COLORS[i % COLORS.length]}
                stroke="rgba(0,0,0,0.1)"
                strokeWidth="0.5"
              />
              <g transform={`rotate(${sliceAngle / 2}) translate(45, 0)`}>
                <text
                  fill="#ffffff"
                  fontSize={fontSize}
                  fontFamily="sans-serif"
                  fontWeight="bold"
                  dominantBaseline="central"
                  textAnchor="end"
                  className="drop-shadow-md"
                >
                  {stu.length > 15 ? stu.substring(0, 12) + '...' : stu}
                </text>
              </g>
            </g>
          ))}
          {/* Center Hub */}
          <circle cx="0" cy="0" r="10" fill="#1e293b" stroke="#334155" strokeWidth="2" />
          <circle cx="0" cy="0" r="5" fill="#f59e0b" />
        </svg>
      </motion.div>
    );
  };

  return (
    <div className="min-h-full bg-slate-950 p-4 md:p-8 rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col font-sans">
      {/* Header */}
      <div className="flex justify-between items-center mb-8 relative z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-pink-500/20 rounded-xl flex items-center justify-center text-pink-400 border border-pink-500/30">
            <Star size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-orange-400">
              {T.title}
            </h1>
            <p className="text-subtle text-sm font-medium">{T.subtitle}</p>
          </div>
        </div>

        <button
          onClick={() => setIsSettingsOpen(true)}
          className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 transition-colors border border-slate-700 hover:border-slate-600 focus:outline-none"
        >
          <Settings size={20} />
        </button>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-8 items-center justify-center relative z-10 w-full max-w-6xl mx-auto">
        {/* Left: The Wheel */}
        <div className="relative w-full max-w-[400px] aspect-square shrink-0">
          {/* The Pointer */}
          {students.length > 0 && (
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
              <svg width="40" height="50" viewBox="0 0 40 50">
                <path
                  d="M20 50 L0 15 C0 5 10 0 20 0 C30 0 40 5 40 15 Z"
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              </svg>
            </div>
          )}

          {/* Wheel Container */}
          <div className="w-full h-full rounded-full ring-[8px] ring-slate-800/80 p-2 bg-slate-900 shadow-[0_0_50px_-10px_rgba(0,0,0,0.5)]">
            {renderWheel()}
          </div>
        </div>

        {/* Right: Controls & Results */}
        <div className="flex-1 w-full max-w-md flex flex-col items-center lg:items-start ml-0 lg:ml-12 space-y-8">
          <div className="text-center lg:text-left w-full">
            <h2 className="text-3xl lg:text-5xl font-black text-white mb-2 tracking-tight">
              AI LUCKY WHEEL
            </h2>
            <p className="text-subtle text-lg">{T.description}</p>
          </div>

          {/* Quick Class Selector in Main UI */}
          {classes.length > 0 && (
            <div className="w-full relative">
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={isLoadingData || isSpinning}
                className="w-full bg-slate-900 border border-slate-700/50 rounded-xl p-4 text-white appearance-none outline-none focus:border-pink-500 shadow-inner font-medium"
              >
                <option value="">{T.selectClass}</option>
                {sortedClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatClassNameWithTeacher(c, classTeachers)}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-subtle">
                {isLoadingData ? (
                  <Loader2 size={20} className="animate-spin text-pink-500" />
                ) : (
                  <Users size={20} />
                )}
              </div>
            </div>
          )}

          <button
            onClick={spinWheel}
            disabled={isSpinning || students.length === 0}
            className="w-full lg:w-auto relative px-10 py-5 bg-gradient-to-r from-pink-500 to-orange-500 hover:from-pink-400 hover:to-orange-400 text-white font-black text-2xl rounded-2xl shadow-[0_10px_40px_-10px_rgba(236,72,153,0.6)] flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed group overflow-hidden"
          >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform" />
            <Play size={28} className="fill-white" />
            <span>{T.spinNow}</span>
          </button>

          {hasRemovedStudents && (
            <button
              type="button"
              onClick={resetWheelSession}
              disabled={isSpinning}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800/80 px-4 py-2.5 text-sm font-bold text-slate-100 transition-colors hover:bg-slate-700 disabled:opacity-60 lg:w-auto"
            >
              <RotateCcw size={18} />
              <span>{T.resetWheelSession || (language === 'vi' ? 'Khôi phục' : 'Reset')}</span>
            </button>
          )}

          {/* Normal Winner Block */}
          <AnimatePresence mode="wait">
            {winner && !winner.isTroll && hasFinalWinner && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="w-full bg-emerald-500/10 border border-emerald-500/30 p-6 rounded-2xl text-center backdrop-blur-md"
              >
                <p className="text-emerald-400 text-sm font-bold uppercase tracking-widest mb-1">
                  {T.selectedStudent}
                </p>
                <h3 className="text-4xl font-black text-white">{winner.realWinner}</h3>
                {renderWinnerActions()}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Troll Winner Block */}
          <AnimatePresence>
            {winner && winner.isTroll && hasFinalWinner && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full relative z-40 bg-gradient-to-br from-pink-500 to-rose-600 p-6 rounded-2xl shadow-2xl text-center border-4 border-pink-400/50"
              >
                <motion.h3
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-4xl font-black text-white"
                >
                  {T.butItIs ? (
                    <>
                      {T.butItIs} <br />
                    </>
                  ) : null}
                  <span className="text-yellow-300 drop-shadow-md text-5xl inline-block mt-2">
                    {winner.realWinner}
                  </span>
                </motion.h3>
                {renderWinnerActions()}
                <div className="absolute -top-4 -right-4 text-5xl animate-bounce">🤪</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <ModalPortal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
              >
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/50 shrink-0">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Settings2 className="text-pink-400" /> {T.wheelSettings}
                  </h3>
                  <button
                    onClick={() => setIsSettingsOpen(false)}
                    className="text-subtle hover:text-white"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                  {/* Class selection from the read API */}
                  <div className="bg-slate-800/50 border border-slate-700 p-4 rounded-xl">
                    <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                      <Database size={16} className="text-emerald-400" /> {T.autoFromDatabase}
                    </label>
                    <div className="relative">
                      <select
                        value={selectedClassId}
                        onChange={(e) => setSelectedClassId(e.target.value)}
                        disabled={isLoadingData || classes.length === 0}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white appearance-none outline-none focus:border-pink-500"
                      >
                        <option value="">{T.selectClass}</option>
                        {sortedClasses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {formatClassNameWithTeacher(c, classTeachers)}
                          </option>
                        ))}
                      </select>
                      {isLoadingData && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-pink-500">
                          <Loader2 size={18} className="animate-spin" />
                        </div>
                      )}
                    </div>
                    {classes.length === 0 && (
                      <p className="text-xs text-amber-500 mt-2">{T.noClasses}</p>
                    )}
                  </div>

                  <div className="text-center text-muted font-bold uppercase text-xs tracking-widest">
                    {T.orManual}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      {T.listLabel}
                    </label>
                    <textarea
                      value={studentsInput}
                      onChange={(e) => setStudentsInput(e.target.value)}
                      className="w-full h-40 bg-slate-950 border border-slate-700 rounded-xl p-3 text-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none resize-none font-mono text-sm leading-relaxed"
                      placeholder={T.inputPlaceholder}
                    />
                    <p className="text-xs text-muted mt-2">
                      {T.studentCount.replace(
                        '{count}',
                        String(studentsInput.split('\\n').filter((s) => s.trim()).length)
                      )}
                    </p>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-sm font-medium text-pink-400 flex items-center gap-2">
                        {T.trollMode}
                      </label>
                      <span className="bg-slate-800 text-pink-400 text-xs font-bold px-2 py-1 rounded-md">
                        {trollModeRate}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={trollModeRate}
                      onChange={(e) => setTrollModeRate(parseInt(e.target.value))}
                      className="w-full accent-pink-500"
                    />
                    <p className="text-xs text-muted mt-1">{T.trollHint}</p>
                  </div>
                </div>

                <div className="p-6 border-t border-slate-800 shrink-0">
                  <button
                    onClick={saveSettings}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isLoadingData ? <Loader2 className="animate-spin" size={20} /> : null}{' '}
                    {T.saveAndSpin}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}
