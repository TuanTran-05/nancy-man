import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Menu } from 'lucide-react';
import { getLessonDeckById } from '../../data/global-success';
import LessonSlideRenderer from './LessonSlideRenderer';
import { cn } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';

type SlideDirection = 1 | -1;

const slideVariants: Variants = {
  enter: (direction: SlideDirection) => ({
    opacity: 0,
    x: direction > 0 ? 56 : -56,
    scale: 0.985,
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
  },
  exit: (direction: SlideDirection) => ({
    opacity: 0,
    x: direction > 0 ? -56 : 56,
    scale: 0.99,
  }),
};

export default function LessonPlayer() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = translations[language].knowledgeBankV2;
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<SlideDirection>(1);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const deck = useMemo(() => (deckId ? getLessonDeckById(deckId) : undefined), [deckId]);
  const slides = deck?.slides || [];
  const currentSlide = slides[currentSlideIndex];
  const progress = slides.length ? ((currentSlideIndex + 1) / slides.length) * 100 : 0;
  const slideTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: 'easeOut' as const };
  const controlHover = shouldReduceMotion ? undefined : { y: -1, scale: 1.03 };
  const controlTap = shouldReduceMotion ? undefined : { scale: 0.96 };
  const controlButtonClass =
    'flex h-[clamp(2rem,3.2vw,2.75rem)] w-[clamp(2rem,3.2vw,2.75rem)] items-center justify-center rounded-full bg-white/88 text-[#4d46e8] shadow-[0_8px_18px_rgba(84,93,114,0.24)] backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45 dark:bg-slate-800/90 dark:text-indigo-300 dark:shadow-none dark:hover:bg-slate-700';

  const goBack = () => {
    if (deck) {
      navigate(`/knowledge-bank/global-success/grade-${deck.grade}?unit=${deck.unitNumber}`);
      return;
    }
    navigate('/knowledge-bank');
  };

  const goPrevious = () => {
    setSlideDirection(-1);
    setCurrentSlideIndex((index) => Math.max(index - 1, 0));
  };

  const goNext = () => {
    setSlideDirection(1);
    setCurrentSlideIndex((index) => Math.min(index + 1, slides.length - 1));
  };

  const goToSlide = (index: number) => {
    if (index === currentSlideIndex) {
      setIsMenuOpen(false);
      return;
    }
    setSlideDirection(index > currentSlideIndex ? 1 : -1);
    setCurrentSlideIndex(index);
    setIsMenuOpen(false);
  };

  const toggleFullscreen = () => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    setCurrentSlideIndex(0);
    setSlideDirection(1);
    setIsMenuOpen(false);
  }, [deckId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrevious();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isMenuOpen) {
          setIsMenuOpen(false);
          return;
        }
        goBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deck, isMenuOpen, slides.length]);

  if (!deck || !currentSlide) {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950 px-4 text-white">
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-black">{t.lessonNotFound}</h1>
          <p className="mt-3 text-sm text-slate-300">{t.lessonNotFoundDesc}</p>
          <button
            type="button"
            onClick={() => navigate('/knowledge-bank')}
            className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-slate-950 transition hover:bg-blue-50 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            {t.back}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lesson-player-stage fixed inset-0 z-[2000] flex items-center justify-center overflow-hidden p-3 text-slate-950 dark:text-slate-100 sm:p-4">
      <main
        className="relative aspect-video overflow-hidden rounded-[1.45rem] border-[5px] border-[#f2a89f] bg-white shadow-[0_28px_70px_rgba(83,65,74,0.24)] dark:border-rose-400/45 dark:bg-slate-900 dark:shadow-none sm:rounded-[1.8rem]"
        style={{
          width: 'min(calc(100vw - 2rem), calc((100vh - 3rem) * 16 / 9))',
        }}
      >
        <AnimatePresence custom={slideDirection} initial={false} mode="wait">
          <motion.div
            key={currentSlide.id}
            custom={slideDirection}
            variants={shouldReduceMotion ? undefined : slideVariants}
            initial={shouldReduceMotion ? { opacity: 1 } : 'enter'}
            animate={shouldReduceMotion ? { opacity: 1 } : 'center'}
            exit={shouldReduceMotion ? { opacity: 0 } : 'exit'}
            transition={slideTransition}
            className="absolute inset-0"
          >
            <LessonSlideRenderer slide={currentSlide} />
          </motion.div>
        </AnimatePresence>

        <div className="absolute right-[clamp(0.45rem,1.3vw,1.1rem)] top-[clamp(0.45rem,1.3vw,1.1rem)] z-30 flex items-center gap-[clamp(0.25rem,0.8vw,0.55rem)]">
          <motion.button
            type="button"
            onClick={goPrevious}
            disabled={currentSlideIndex === 0}
            whileHover={currentSlideIndex === 0 ? undefined : controlHover}
            whileTap={currentSlideIndex === 0 ? undefined : controlTap}
            className={controlButtonClass}
            title={t.previous}
          >
            <ChevronLeft className="h-[55%] w-[55%]" />
          </motion.button>
          <motion.button
            type="button"
            onClick={goNext}
            disabled={currentSlideIndex === slides.length - 1}
            whileHover={currentSlideIndex === slides.length - 1 ? undefined : controlHover}
            whileTap={currentSlideIndex === slides.length - 1 ? undefined : controlTap}
            className={controlButtonClass}
            title={t.next}
          >
            <ChevronRight className="h-[55%] w-[55%]" />
          </motion.button>
          <motion.button
            type="button"
            onClick={() => setIsMenuOpen((value) => !value)}
            whileHover={controlHover}
            whileTap={controlTap}
            className={controlButtonClass}
            title={deck.title}
            aria-expanded={isMenuOpen}
          >
            <Menu className="h-[55%] w-[55%]" />
          </motion.button>
          <motion.button
            type="button"
            onClick={toggleFullscreen}
            whileHover={controlHover}
            whileTap={controlTap}
            className={controlButtonClass}
            title={t.fullscreen}
          >
            <Maximize2 className="h-[50%] w-[50%]" />
          </motion.button>
          <span className="flex h-[clamp(2rem,3.2vw,2.75rem)] min-w-[clamp(2.35rem,4vw,3.2rem)] items-center justify-center rounded-full bg-white/88 px-2 text-[clamp(0.65rem,1.05vw,0.85rem)] font-black text-[#4d46e8] shadow-[0_8px_18px_rgba(84,93,114,0.24)] backdrop-blur dark:bg-slate-800/90 dark:text-indigo-300 dark:shadow-none">
            {currentSlideIndex + 1}/{slides.length}
          </span>
        </div>

        <AnimatePresence>
          {isMenuOpen && (
            <motion.aside
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
              transition={
                shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }
              }
              className="absolute right-[clamp(0.65rem,1.5vw,1.25rem)] top-[clamp(3rem,5vw,4.2rem)] z-40 w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border border-white/80 bg-white/94 p-4 shadow-[0_18px_38px_rgba(51,65,85,0.24)] backdrop-blur-md dark:border-slate-600/80 dark:bg-slate-900/95 dark:shadow-none"
            >
              <h2 className="line-clamp-2 text-sm font-black text-slate-950 dark:text-slate-50">
                {deck.title}
              </h2>
              <motion.button
                type="button"
                onClick={goBack}
                whileHover={controlHover}
                whileTap={controlTap}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#4d46e8] px-3 text-sm font-black text-white transition hover:bg-[#4338ca]"
              >
                <ArrowLeft className="h-4 w-4" />
                {t.back}
              </motion.button>
              <div className="mt-4 grid max-h-[min(48vh,20rem)] grid-cols-4 gap-2 overflow-y-auto pr-1">
                {slides.map((slide, index) => (
                  <motion.button
                    key={slide.id}
                    type="button"
                    onClick={() => goToSlide(index)}
                    whileHover={index === currentSlideIndex ? undefined : controlHover}
                    whileTap={index === currentSlideIndex ? undefined : controlTap}
                    className={cn(
                      'flex h-10 items-center justify-center rounded-xl text-sm font-black transition',
                      index === currentSlideIndex
                        ? 'bg-[#4d46e8] text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    )}
                    title={slide.title}
                  >
                    {index + 1}
                  </motion.button>
                ))}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-1 bg-white/45 dark:bg-slate-700/70">
          <motion.div
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.28, ease: 'easeOut' }}
            className="h-full rounded-r-full bg-[#4d46e8] dark:bg-indigo-400"
          />
        </div>
      </main>
    </div>
  );
}
