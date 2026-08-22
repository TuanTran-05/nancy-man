import React, { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import {
  Gamepad2,
  Rocket,
  RotateCcw,
  X,
  Scan,
  Zap,
  RefreshCw,
  Maximize,
  Play,
  CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../../lib/i18n/useLanguage';

export default function LuckyLens() {
  const { t } = useLanguage();
  const tl = t.luckyLensPage;
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const animationFrameRef = useRef<number | null>(null);
  const detectFacesRef = useRef<(() => void) | null>(null);
  const countdownIntervalRef = useRef<any>(null);
  const selectionTimeoutRef = useRef<any>(null);

  const [faceDetector, setFaceDetector] = useState<any | null>(null);
  const [isFaceDetectorLoading, setIsFaceDetectorLoading] = useState(true);
  const [detectedFaces, setDetectedFaces] = useState<any[]>([]);

  const [gameState, setGameState] = useState<'idle' | 'tutorial' | 'scanning' | 'selected'>('idle');

  const [selectedFace, setSelectedFace] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [snapshotImage, setSnapshotImage] = useState<string | null>(null);
  const [selectedFaceBbox, setSelectedFaceBbox] = useState<any>(null);
  const [snapshotDimensions, setSnapshotDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const stopScheduledWork = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (countdownIntervalRef.current !== null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (selectionTimeoutRef.current !== null) {
      window.clearTimeout(selectionTimeoutRef.current);
      selectionTimeoutRef.current = null;
    }
  }, []);

  // Play 'ting' sound
  const playTingSound = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
      osc.start();
      osc.stop(ctx.currentTime + 1);
    } catch (e) {
      console.error('Audio playback error', e);
    }
  }, []);

  useEffect(() => {
    let detector: any;
    async function initMediaPipe() {
      try {
        const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        detector = await FaceDetector.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5,
        });
        setFaceDetector(detector);
        setIsFaceDetectorLoading(false);
      } catch (err) {
        setErrorMessage(tl.faceDetectionError);
        setIsFaceDetectorLoading(false);
      }
    }
    initMediaPipe();
    return () => {
      if (detector) detector.close();
    };
  }, []);

  const queueDetectFaces = useCallback(() => {
    animationFrameRef.current = window.requestAnimationFrame(() => {
      detectFacesRef.current?.();
    });
  }, []);

  const detectFaces = useCallback(() => {
    if (webcamRef.current && webcamRef.current.video && faceDetector && gameState === 'scanning') {
      const video = webcamRef.current.video;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        queueDetectFaces();
        return;
      }

      const nowInMs = Date.now();
      const faceResults = faceDetector.detectForVideo(video, nowInMs);

      setDetectedFaces(faceResults.detections);

      if (canvasRef.current && video) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          faceResults.detections.forEach((detection) => {
            const bbox = detection.boundingBox;
            if (bbox) {
              ctx.strokeStyle = '#10b981'; // Emerald 500
              ctx.lineWidth = 4;
              ctx.strokeRect(bbox.originX, bbox.originY, bbox.width, bbox.height);
            }
          });
        }
      }
    }

    if (gameState === 'scanning') {
      queueDetectFaces();
    }
  }, [faceDetector, gameState, queueDetectFaces]);

  useEffect(() => {
    detectFacesRef.current = detectFaces;
  }, [detectFaces]);

  useEffect(() => {
    if (gameState !== 'scanning') {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    queueDetectFaces();
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [gameState, queueDetectFaces]);

  const initGame = () => {
    setGameState('tutorial');
  };

  const startScanning = () => {
    stopScheduledWork();
    setGameState('scanning');
    setErrorMessage(null);
    setSelectedFace(null);
    setSnapshotImage(null);
    setSelectedFaceBbox(null);
    setSnapshotDimensions(null);
    setDetectedFaces([]);
    setCountdown(5);

    countdownIntervalRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev === 1) {
          if (countdownIntervalRef.current !== null) {
            window.clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          handleSelection();
          return null;
        }
        return (prev || 0) - 1;
      });
    }, 1000);
  };

  // Split out selection logic so "Gọi bạn khác" can reuse the same snapshot
  const handleSelection = () => {
    // Need to capture state at this exact moment
    // Wait for the next tick to ensure we have the latest detections
    if (selectionTimeoutRef.current !== null) {
      window.clearTimeout(selectionTimeoutRef.current);
    }
    selectionTimeoutRef.current = window.setTimeout(() => {
      setGameState((currentState) => {
        // Only proceed if we were scanning
        if (currentState !== 'scanning') return currentState;

        // We use state functional update to get the latest detectedFaces
        setDetectedFaces((currentFaces) => {
          if (currentFaces.length === 0) {
            setErrorMessage(tl.noStudentsFound);
            // Re-enable scanning or just stay in a failed state?
            // Let's just go back to idle on error for simplicity
            return currentFaces;
          }

          // Capture snapshot
          if (webcamRef.current) {
            const imageSrc = webcamRef.current.getScreenshot();
            setSnapshotImage(imageSrc);
            const video = webcamRef.current.video;
            setSnapshotDimensions(
              video ? { width: video.videoWidth, height: video.videoHeight } : null
            );
          }

          const index = Math.floor(Math.random() * currentFaces.length);
          setSelectedFace(index);
          setSelectedFaceBbox(currentFaces[index].boundingBox);

          playTingSound();

          // Because we are inside setDetectedFaces, we explicitly return it unchanged
          return currentFaces;
        });

        return 'selected';
      });
      selectionTimeoutRef.current = null;
    }, 50); // slight delay to ensure final frame drawn
  };

  useEffect(() => {
    return stopScheduledWork;
  }, [stopScheduledWork]);

  const pickAnother = () => {
    if (detectedFaces.length > 0) {
      const index = Math.floor(Math.random() * detectedFaces.length);
      setSelectedFace(index);
      setSelectedFaceBbox(detectedFaces[index].boundingBox);
      playTingSound();
    }
  };

  return (
    <div className="min-h-full bg-slate-950 p-6 md:p-8 rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden text-white font-sans">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 relative z-20">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400">
            <Scan size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
              Lucky Lens AI
            </h1>
            <p className="text-subtle text-sm font-medium">{tl.subtitle}</p>
          </div>
        </div>

        {/* Close/Reset Button when not idle and not tutorial */}
        {gameState !== 'idle' && gameState !== 'tutorial' && (
          <button
            onClick={() => {
              stopScheduledWork();
              setGameState('idle');
              setCountdown(null);
            }}
            className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="relative aspect-video w-full max-w-5xl mx-auto rounded-3xl overflow-hidden bg-slate-900 border border-slate-800/60 shadow-inner">
        {/* State: IDLE */}
        <AnimatePresence>
          {gameState === 'idle' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm z-30"
            >
              <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6 ring-4 ring-emerald-500/20">
                {isFaceDetectorLoading ? (
                  <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin" />
                ) : (
                  <Zap className="w-12 h-12 text-emerald-400" />
                )}
              </div>
              <h2 className="text-3xl font-bold mb-8 text-white">
                {isFaceDetectorLoading ? tl.loadingAI : tl.ready}
              </h2>
              <button
                onClick={initGame}
                disabled={isFaceDetectorLoading}
                className="group relative px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xl rounded-2xl shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)] transition-all flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Scan size={24} className="group-hover:scale-110 transition-transform" />
                <span>🎯 {tl.startCall}</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* State: TUTORIAL */}
        <AnimatePresence>
          {gameState === 'tutorial' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-0 flex items-center justify-center bg-slate-950/90 backdrop-blur z-30 p-8"
            >
              <div className="bg-slate-900 border border-slate-700 p-8 rounded-3xl max-w-xl w-full shadow-2xl">
                <div className="flex justify-center mb-6">
                  <div className="w-16 h-16 bg-blue-500/20 text-blue-400 rounded-2xl flex items-center justify-center">
                    <Scan size={32} />
                  </div>
                </div>
                <h2 className="text-2xl font-bold text-center mb-8">{tl.tutorialTitle}</h2>

                <div className="space-y-6 mb-10">
                  <div className="flex gap-4 items-start">
                    <div className="w-8 h-8 rounded-full bg-slate-800 text-emerald-400 font-bold flex items-center justify-center shrink-0">
                      1
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg text-white">{tl.step1Title}</h3>
                      <p className="text-subtle">{tl.step1Desc}</p>
                    </div>
                  </div>
                  <div className="flex gap-4 items-start">
                    <div className="w-8 h-8 rounded-full bg-slate-800 text-emerald-400 font-bold flex items-center justify-center shrink-0">
                      2
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg text-white">{tl.step2Title}</h3>
                      <p className="text-subtle">{tl.step2Desc}</p>
                    </div>
                  </div>
                  <div className="flex gap-4 items-start">
                    <div className="w-8 h-8 rounded-full bg-slate-800 text-emerald-400 font-bold flex items-center justify-center shrink-0">
                      3
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg text-white">{tl.step3Title}</h3>
                      <p className="text-subtle">{tl.step3Desc}</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={startScanning}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg"
                >
                  {tl.readyToScan} <Play size={20} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The Webcam Layer (Active during Scanning or running) */}
        {(gameState === 'scanning' || gameState === 'selected') && (
          <div className="absolute inset-0">
            {gameState === 'selected' && snapshotImage ? (
              <div className="absolute inset-0">
                {/* Background dimmed snapshot */}
                <img
                  src={snapshotImage}
                  alt="Background Snapshot"
                  className="w-full h-full object-cover filter blur-sm brightness-50"
                />

                {/* Zoomed Selected Face */}
                {selectedFaceBbox && snapshotDimensions && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', damping: 15, stiffness: 100 }}
                    className="absolute inset-0 z-20 flex items-center justify-center"
                  >
                    <div
                      className="relative overflow-hidden rounded-full border-4 border-emerald-400 shadow-[0_0_50px_rgba(16,185,129,0.5)] bg-slate-900"
                      style={{ width: '300px', height: '300px' }} // Fixed circle size for the zoomed view
                    >
                      {/* Inner image scaled and positioned perfectly */}
                      {(() => {
                        // We want the bounding box (plus padding) to fill the 300x300 circle
                        const boxSize =
                          Math.max(selectedFaceBbox.width, selectedFaceBbox.height) * 1.5; // 1.5x padding
                        const scale = 300 / boxSize;

                        const centerX = selectedFaceBbox.originX + selectedFaceBbox.width / 2;
                        const centerY = selectedFaceBbox.originY + selectedFaceBbox.height / 2;

                        const left = -(centerX * scale - 150);
                        const top = -(centerY * scale - 150);

                        return (
                          <img
                            src={snapshotImage}
                            alt="Selected Student"
                            className="absolute max-w-none"
                            style={{
                              width: `${snapshotDimensions.width * scale}px`,
                              height: `${snapshotDimensions.height * scale}px`,
                              left: `${left}px`,
                              top: `${top}px`,
                            }}
                          />
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </div>
            ) : (
              <>
                <Webcam ref={webcamRef} className="absolute inset-0 w-full h-full object-cover" />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-10" />
              </>
            )}

            {/* Overlays during Scanning */}
            {gameState === 'scanning' && (
              <div className="absolute inset-x-0 bottom-0 p-8 flex flex-col items-center justify-end bg-gradient-to-t from-slate-950/90 via-slate-900/40 to-transparent z-20">
                <div className="text-7xl font-black text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] mb-4 font-mono">
                  {countdown}
                </div>
                <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700 px-6 py-3 rounded-full flex items-center gap-3">
                  <Scan className="text-emerald-400 animate-pulse" size={20} />
                  <span className="text-lg font-medium">
                    {tl.scanning}{' '}
                    <span className="text-emerald-400 font-bold">{detectedFaces.length}</span>{' '}
                    {tl.faces} ({countdown}s)
                  </span>
                </div>
              </div>
            )}

            {/* Errors */}
            {errorMessage && gameState === 'scanning' && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-30">
                <div className="bg-red-500/10 border border-red-500 p-6 rounded-2xl max-w-md text-center">
                  <X className="w-12 h-12 text-red-500 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-red-400 mb-2">{tl.scanFailed}</h3>
                  <p className="text-slate-300 mb-6">{errorMessage}</p>
                  <button
                    onClick={() => {
                      stopScheduledWork();
                      setGameState('idle');
                    }}
                    className="bg-slate-800 hover:bg-slate-700 px-6 py-2 rounded-xl text-white font-medium"
                  >
                    {tl.retry}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Control Panel (Visible only when Selected) */}
      <AnimatePresence>
        {gameState === 'selected' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 p-2 rounded-2xl shadow-2xl z-50"
          >
            <div className="px-6 py-3 border-r border-slate-700 flex items-center gap-2">
              <CheckCircle2 className="text-emerald-400" size={24} />
              <span className="font-bold text-lg text-white">{tl.selectedStudent}</span>
            </div>

            <button
              onClick={pickAnother}
              className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium flex items-center gap-2 transition-colors"
            >
              <RefreshCw size={18} /> {tl.pickAnother}
            </button>

            <button
              onClick={startScanning}
              className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-colors"
            >
              <Scan size={18} /> {tl.rescan}
            </button>

            <button
              onClick={() => {
                stopScheduledWork();
                setGameState('idle');
              }}
              className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-subtle font-medium transition-colors border border-transparent hover:border-red-500/50"
            >
              {tl.close}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
