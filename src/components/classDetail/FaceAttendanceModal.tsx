import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Scan, Camera, RefreshCw, CheckCircle2, AlertCircle, Users } from 'lucide-react';
import { auth } from '../../lib/auth/sessionAuth';
import { Class, Student } from '../../types';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';
import { resolveStudentFaceUrl } from '../../lib/student/faceImage';
import { readChannel } from '../../lib/api/readApi';
import { readClassesData } from '../../lib/api/frontendReadApi';
import { FRONTEND_LARGE_COLLECTION_LIMIT } from '../../lib/api/readLimits';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../shared/classVisibility';
import { getClassSessionForDate, getVietnamTodayStr } from '../../../shared/classSchedule';
import { useAuth } from '../../contexts/AuthContext';

interface FaceAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  classData: Class;
  students: Student[];
  onAttendanceMarked: (studentId: string, date: string, status?: any) => Promise<void>;
}

type FaceAttendanceBlockReason = 'on_leave' | 'inactive' | 'missing_face_data';

export type FaceAttendanceEligibility = {
  canBuildDescriptor: boolean;
  canMarkAttendance: boolean;
  blockReason: FaceAttendanceBlockReason | null;
};

export function getFaceAttendanceEligibility(student: Student): FaceAttendanceEligibility {
  const hasFaceData = Boolean(student.faceImage || student.faceImageStoragePath);
  if (!hasFaceData) {
    return {
      canBuildDescriptor: false,
      canMarkAttendance: false,
      blockReason: 'missing_face_data',
    };
  }

  if (
    student.enrollmentStatus === 'dropped' ||
    student.enrollmentStatus === 'promoted' ||
    student.studentLifecycle === 'archived' ||
    student.isRevoked === true
  ) {
    return {
      canBuildDescriptor: false,
      canMarkAttendance: false,
      blockReason: 'inactive',
    };
  }

  if (student.enrollmentStatus === 'on_leave') {
    return {
      canBuildDescriptor: true,
      canMarkAttendance: false,
      blockReason: 'on_leave',
    };
  }

  return {
    canBuildDescriptor: true,
    canMarkAttendance: true,
    blockReason: null,
  };
}

export function shouldBuildFaceDescriptorForStudent(student: Student): boolean {
  return getFaceAttendanceEligibility(student).canBuildDescriptor;
}

export type FaceAttendanceMarkDecision =
  | { kind: 'mark'; labelTone: 'success' }
  | { kind: 'blocked'; reason: 'on_leave'; labelTone: 'warning' }
  | { kind: 'wrong_class'; labelTone: 'warning' }
  | { kind: 'unknown'; labelTone: 'danger' };

export function getFaceAttendanceMarkDecision(
  student: Student | undefined,
  activeClassId: string
): FaceAttendanceMarkDecision {
  if (!student) return { kind: 'unknown', labelTone: 'danger' };
  if (student.classId !== activeClassId) return { kind: 'wrong_class', labelTone: 'warning' };

  const eligibility = getFaceAttendanceEligibility(student);
  if (!eligibility.canMarkAttendance && eligibility.blockReason === 'on_leave') {
    return { kind: 'blocked', reason: 'on_leave', labelTone: 'warning' };
  }
  if (!eligibility.canMarkAttendance) return { kind: 'unknown', labelTone: 'danger' };

  return { kind: 'mark', labelTone: 'success' };
}

export function FaceAttendanceModal({
  isOpen,
  onClose,
  classData,
  students,
  onAttendanceMarked,
}: FaceAttendanceModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const { profile } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceapiRef = useRef<any>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [result, setResult] = useState<{ student: Student; status: string } | null>(null);
  const [blockedResult, setBlockedResult] = useState<{
    student: Student;
    reason: 'on_leave';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [allTeacherStudents, setAllTeacherStudents] = useState<Student[]>([]);
  const [allTeacherClasses, setAllTeacherClasses] = useState<Class[]>([]);
  const [faceMatcher, setFaceMatcher] = useState<any | null>(null);
  const [markedStudents, setMarkedStudents] = useState<Set<string>>(new Set());
  const [isPreparingMatcher, setIsPreparingMatcher] = useState(false);

  useEffect(() => {
    if (!auth.currentUser || !isOpen) return;

    let studentsReadCancelled = false;
    readChannel<{ students: Student[] }>('students', {
      view: 'attendance',
      classId: classData.id,
      limit: FRONTEND_LARGE_COLLECTION_LIMIT,
    })
      .then((data) => {
        if (!studentsReadCancelled) setAllTeacherStudents(data.students || []);
      })
      .catch((error) => {
        console.error('Error loading students:', error);
      });

    // Fetch classes
    const fetchClasses = async () => {
      try {
        const role = profile?.role || 'teacher';
        const payload = await readClassesData();
        const fetchedClasses = payload.classes || [];
        setAllTeacherClasses(filterClassesForRoleOutsideAdminDashboard(fetchedClasses, role));
      } catch (err) {
        console.error('Error fetching classes:', err);
      }
    };
    fetchClasses();

    return () => {
      studentsReadCancelled = true;
    };
  }, [isOpen, classData.id, profile?.role]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const faceapi = await import('face-api.js');
        faceapiRef.current = faceapi;
        const MODEL_URL =
          'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        setModelsLoaded(true);
      } catch (err) {
        console.error('Error loading face-api models:', err);
        setError('Failed to load face recognition models. Please check your internet connection.');
      }
    };
    loadModels();
  }, []);

  useEffect(() => {
    if (!modelsLoaded || allTeacherStudents.length === 0 || !isOpen) return;

    const createMatcher = async () => {
      setIsPreparingMatcher(true);
      try {
        const studentsWithImages = allTeacherStudents.filter(shouldBuildFaceDescriptorForStudent);
        if (studentsWithImages.length === 0) {
          setIsPreparingMatcher(false);
          return;
        }

        const labeledDescriptors = await Promise.all(
          studentsWithImages.map(async (student) => {
            try {
              const faceUrl = await resolveStudentFaceUrl(
                student.id,
                student.faceImage,
                student.faceImageStoragePath
              );
              const img = await faceapiRef.current.fetchImage(faceUrl);
              const studentDetection = await faceapiRef.current
                .detectSingleFace(img)
                .withFaceLandmarks()
                .withFaceDescriptor();

              if (!studentDetection) return null;
              return new faceapiRef.current.LabeledFaceDescriptors(student.id, [
                studentDetection.descriptor,
              ]);
            } catch (err) {
              console.error(`Error processing image for student ${student.name}:`, err);
              return null;
            }
          })
        );

        const validDescriptors = labeledDescriptors.filter((d): d is any => d !== null);
        if (validDescriptors.length > 0) {
          // Use a stricter threshold (0.45 instead of 0.5) to prevent misidentification
          setFaceMatcher(new faceapiRef.current.FaceMatcher(validDescriptors, 0.45));
        }
      } catch (err) {
        console.error('Error creating face matcher:', err);
      } finally {
        setIsPreparingMatcher(false);
      }
    };

    createMatcher();
  }, [modelsLoaded, allTeacherStudents, isOpen]);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      setStream(s);
      setIsCameraActive(true);
      setError(null);
    } catch (err) {
      console.error('Error accessing camera:', err);
      setError('Could not access camera. Please check permissions.');
    }
  };

  useEffect(() => {
    if (isCameraActive && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [isCameraActive, stream]);

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    if (isOpen) {
      startCamera();
      setMarkedStudents(new Set()); // Reset marked students when modal opens
      setBlockedResult(null);
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen]);

  useEffect(() => {
    if (!isCameraActive || !faceMatcher || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    let isScanning = true;

    const scanFaces = async () => {
      if (!isScanning || video.paused || video.ended || video.videoWidth === 0) {
        if (isScanning) setTimeout(scanFaces, 100); // Retry if video not ready
        return;
      }

      try {
        // Increase minConfidence to 0.6 to avoid detecting random objects/background faces as faces
        const detections = await faceapiRef.current
          .detectAllFaces(
            video,
            new faceapiRef.current.SsdMobilenetv1Options({ minConfidence: 0.6 })
          )
          .withFaceLandmarks()
          .withFaceDescriptors();

        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapiRef.current.matchDimensions(canvas, displaySize);
        const resizedDetections = faceapiRef.current.resizeResults(detections, displaySize);

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        for (const detection of resizedDetections) {
          const box = detection.detection.box;

          // Ignore faces that are too small (likely in the background)
          if (box.width < 80 || box.height < 80) continue;

          const bestMatch = faceMatcher.findBestMatch(detection.descriptor);

          let label = 'Unknown';
          let boxColor = 'red';

          if (bestMatch.label !== 'unknown') {
            const student = allTeacherStudents.find((s) => s.id === bestMatch.label);
            const decision = getFaceAttendanceMarkDecision(student, classData.id);

            if (student && decision.kind === 'mark') {
              label = student.name;
              boxColor = 'green';

              if (!markedStudents.has(student.id)) {
                setMarkedStudents((prev) => new Set(prev).add(student.id));

                const now = new Date();
                let status: 'present' | 'late' = 'present';
                const todaySession = getClassSessionForDate(classData, getVietnamTodayStr());
                if (todaySession?.startTime) {
                  const [hours, minutes] = todaySession.startTime.split(':').map(Number);
                  const startTime = new Date();
                  startTime.setHours(hours, minutes, 0, 0);
                  const diffMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
                  if (diffMinutes > 15) {
                    status = 'late';
                  }
                }
                const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
                  .toISOString()
                  .split('T')[0];
                onAttendanceMarked(student.id, todayStr, status).catch(console.error);

                setResult({ student, status });
                setTimeout(() => setResult(null), 3000);
              }
            } else if (student && decision.kind === 'blocked' && decision.reason === 'on_leave') {
              label = `${student.name} (${t.faceAttendance.onLeaveLabel})`;
              boxColor = 'orange';
              if (!markedStudents.has(student.id)) {
                setMarkedStudents((prev) => new Set(prev).add(student.id));
                setBlockedResult({ student, reason: 'on_leave' });
                setTimeout(() => setBlockedResult(null), 3000);
              }
            } else if (student && decision.kind === 'wrong_class') {
              label = `${student.name} (${t.faceAttendance.wrongClass})`;
              boxColor = 'orange';
            }
          }

          // Flip box horizontally to match mirrored video
          const flippedBox = {
            x: displaySize.width - box.x - box.width,
            y: box.y,
            width: box.width,
            height: box.height,
          };

          // Custom drawing to handle Vietnamese fonts correctly and avoid mirroring issues
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Draw bounding box
            ctx.strokeStyle = boxColor;
            ctx.lineWidth = 3;
            ctx.strokeRect(flippedBox.x, flippedBox.y, flippedBox.width, flippedBox.height);

            // Draw label background
            ctx.font = 'bold 16px Inter, system-ui, sans-serif';
            const textWidth = ctx.measureText(label).width;
            const textHeight = 24;

            ctx.fillStyle = boxColor;
            ctx.fillRect(flippedBox.x, flippedBox.y - textHeight, textWidth + 16, textHeight);

            // Draw text
            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, flippedBox.x + 8, flippedBox.y - textHeight / 2);
          }
        }
      } catch (err) {
        console.error('Error during face scanning:', err);
      }

      if (isScanning) {
        setTimeout(scanFaces, 300); // Scan every 300ms
      }
    };

    video.addEventListener('play', scanFaces);
    if (!video.paused) {
      scanFaces();
    }

    return () => {
      isScanning = false;
      video.removeEventListener('play', scanFaces);
    };
  }, [
    isCameraActive,
    faceMatcher,
    allTeacherStudents,
    classData,
    markedStudents,
    onAttendanceMarked,
  ]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-emerald-600 text-white">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Scan className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t.faceAttendance.title}</h2>
                <p className="text-emerald-100 text-sm">{classData.name}</p>
              </div>
            </div>
            <button
              type="button"
              aria-label={t.faceAttendance.close}
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-8 flex flex-col items-center">
            <div className="relative w-full aspect-video bg-slate-900 rounded-2xl overflow-hidden border-4 border-slate-100 shadow-inner group flex items-center justify-center">
              {isCameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-contain scale-x-[-1]"
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-500">
                  <Camera className="w-12 h-12 animate-pulse" />
                </div>
              )}

              {/* Scanning Animation */}
              {isCameraActive && faceMatcher && (
                <motion.div
                  initial={{ top: '0%' }}
                  animate={{ top: '100%' }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="absolute left-0 right-0 h-1 bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.8)] z-10 opacity-50"
                />
              )}
            </div>

            <div className="mt-8 w-full space-y-4">
              {blockedResult ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center space-x-4"
                >
                  <div className="w-12 h-12 bg-amber-500 text-white rounded-full flex items-center justify-center">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <p className="text-amber-800 font-medium text-sm">
                    {t.faceAttendance.onLeaveRecognized.replace(
                      '{name}',
                      blockedResult.student.name
                    )}
                  </p>
                </motion.div>
              ) : result ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-center justify-between"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-emerald-800 font-bold">
                        {t.faceAttendance.recognized.replace('{name}', result.student.name)}
                      </p>
                      <p className="text-emerald-600 text-sm font-medium uppercase tracking-wider">
                        {t.faceAttendance.statusLabel.replace('{status}', result.status)}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ) : error ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-center space-x-4"
                >
                  <div className="w-12 h-12 bg-red-500 text-white rounded-full flex items-center justify-center">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <p className="text-red-800 font-medium text-sm">{error}</p>
                </motion.div>
              ) : (
                <div className="text-center text-slate-500 text-sm italic">
                  {!modelsLoaded
                    ? t.faceAttendance.loadingModels
                    : isPreparingMatcher
                      ? t.faceAttendance.preparingFaces
                      : !faceMatcher
                        ? t.faceAttendance.noFaceData
                        : t.faceAttendance.scanning}
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <div className="flex items-center space-x-2 text-slate-500 text-sm">
                  <Users className="w-4 h-4" />
                  <span>
                    {t.faceAttendance.markedToday}{' '}
                    <strong className="text-emerald-600">{markedStudents.size}</strong>
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  {t.faceAttendance.close}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
