import { Image, Volume2 } from 'lucide-react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
import { LessonRichText, LessonSlide, LessonSlideAccent, LessonSlideBullet } from '../../types';
import { cn } from '../../lib/core/utils';

interface LessonSlideRendererProps {
  slide: LessonSlide;
}

const accentStyles: Record<
  LessonSlideAccent,
  {
    text: string;
    border: string;
    soft: string;
    gradient: string;
    divider: string;
    circle: string;
  }
> = {
  blue: {
    text: 'text-[#4d46e8] dark:text-indigo-300',
    border: 'border-[#4f8df7] dark:border-blue-400/50',
    soft: 'bg-[#edf5ff] dark:bg-blue-500/15',
    gradient: 'from-[#4f46e5] to-[#2f7df6]',
    divider: 'border-[#bad7ff] dark:border-blue-400/35',
    circle: 'bg-[#dfeaff] text-[#4d46e8] dark:bg-blue-500/20 dark:text-indigo-200',
  },
  pink: {
    text: 'text-[#e52d83] dark:text-pink-300',
    border: 'border-[#ec4899] dark:border-pink-400/50',
    soft: 'bg-[#fff0f7] dark:bg-pink-500/15',
    gradient: 'from-[#eb47a5] to-[#e9154f]',
    divider: 'border-[#f9bfdc] dark:border-pink-400/35',
    circle: 'bg-[#ffd4ea] text-[#e52d83] dark:bg-pink-500/20 dark:text-pink-200',
  },
  orange: {
    text: 'text-[#f05a16] dark:text-orange-300',
    border: 'border-[#ff7a18] dark:border-orange-400/50',
    soft: 'bg-[#fff3df] dark:bg-orange-500/15',
    gradient: 'from-[#ffd21e] to-[#ff6f19]',
    divider: 'border-[#ffd6a6] dark:border-orange-400/35',
    circle: 'bg-[#ffe485] text-[#d84c0d] dark:bg-orange-500/20 dark:text-orange-200',
  },
  green: {
    text: 'text-[#16a34a] dark:text-green-300',
    border: 'border-[#22c55e] dark:border-green-400/50',
    soft: 'bg-[#eefdf4] dark:bg-green-500/15',
    gradient: 'from-[#33d17a] to-[#12a255]',
    divider: 'border-[#b7efcc] dark:border-green-400/35',
    circle: 'bg-[#d9fbe7] text-[#16a34a] dark:bg-green-500/20 dark:text-green-200',
  },
  purple: {
    text: 'text-[#8d3ff2] dark:text-violet-300',
    border: 'border-[#a855f7] dark:border-violet-400/50',
    soft: 'bg-[#f7f0ff] dark:bg-violet-500/15',
    gradient: 'from-[#a855f7] to-[#6d3fea]',
    divider: 'border-[#dec5ff] dark:border-violet-400/35',
    circle: 'bg-[#eadcff] text-[#7c3aed] dark:bg-violet-500/20 dark:text-violet-200',
  },
  red: {
    text: 'text-[#dc2626] dark:text-red-300',
    border: 'border-[#ef4444] dark:border-red-400/50',
    soft: 'bg-[#fff1f2] dark:bg-red-500/15',
    gradient: 'from-[#f43f5e] to-[#dc2626]',
    divider: 'border-[#fecdd3] dark:border-red-400/35',
    circle: 'bg-[#ffe0e5] text-[#dc2626] dark:bg-red-500/20 dark:text-red-200',
  },
};

const defaultAccent: LessonSlideAccent = 'blue';

const getAccent = (accent?: LessonSlideAccent) => accentStyles[accent || defaultAccent];

const revealContainerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: 0.04,
      staggerChildren: 0.055,
    },
  },
};

const revealItemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
};

const scaleRevealVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.34, ease: 'easeOut' },
  },
};

const renderRichText = (content?: LessonRichText, className?: string) => {
  if (!content) return null;

  if (typeof content === 'string') {
    return <span className={className}>{content}</span>;
  }

  return (
    <span className={className}>
      {content.map((run, index) => (
        <span
          key={`${run.text}-${index}`}
          className={cn(
            run.bold && 'font-black',
            run.italic && 'italic',
            run.accent && accentStyles[run.accent].text
          )}
        >
          {run.text}
        </span>
      ))}
    </span>
  );
};

const getBulletContent = (item: LessonSlideBullet | LessonRichText) => {
  if (typeof item === 'string' || Array.isArray(item)) return item;
  return item.content;
};

function BulletList({
  items,
  className,
  markerClassName,
}: {
  items?: Array<LessonSlideBullet | LessonRichText>;
  className?: string;
  markerClassName?: string;
}) {
  const shouldReduceMotion = useReducedMotion();

  if (!items?.length) return null;

  return (
    <motion.ul
      variants={shouldReduceMotion ? undefined : revealContainerVariants}
      className={cn('space-y-[clamp(0.65rem,1.8vw,1.4rem)]', className)}
    >
      {items.map((item, index) => (
        <motion.li
          key={index}
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className="flex items-start gap-[clamp(0.55rem,1.2vw,1rem)]"
        >
          <span
            className={cn(
              'mt-[0.55em] h-[0.38em] w-[0.38em] shrink-0 rounded-full bg-current',
              markerClassName
            )}
          />
          <span>{renderRichText(getBulletContent(item))}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

function SlideShell({ slide, children }: LessonSlideRendererProps & { children: ReactNode }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      className={cn(
        'lesson-slide-clouds relative h-full w-full overflow-hidden text-[#252b3d] dark:text-slate-100',
        `lesson-slide-clouds--${slide.accent || defaultAccent}`
      )}
    >
      <motion.div
        initial={shouldReduceMotion ? false : 'hidden'}
        animate={shouldReduceMotion ? undefined : 'visible'}
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className="relative z-10 flex h-full flex-col p-[clamp(1rem,3vw,2.25rem)]"
      >
        {slide.label && slide.layout !== 'cover' && slide.layout !== 'section-cover' && (
          <motion.p
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className={cn(
              'mb-[clamp(0.35rem,1vw,0.75rem)] text-[clamp(0.9rem,1.6vw,1.35rem)] font-black',
              getAccent(slide.accent).text
            )}
          >
            {slide.label}
          </motion.p>
        )}
        {children}
      </motion.div>
    </div>
  );
}

function CoverSlide({ slide }: LessonSlideRendererProps) {
  const accent = getAccent(slide.accent || 'orange');
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealItemVariants}
        className="flex h-full items-center justify-center px-[5%]"
      >
        <motion.div
          variants={shouldReduceMotion ? undefined : scaleRevealVariants}
          className={cn(
            'w-full max-w-[min(82%,60rem)] rounded-[clamp(1.25rem,3vw,2.25rem)] bg-gradient-to-r px-[clamp(1.25rem,5vw,4.5rem)] py-[clamp(1.5rem,4.5vw,4rem)] text-center text-white shadow-[0_22px_46px_rgba(110,76,58,0.18)] ring-1 ring-white/55',
            accent.gradient
          )}
        >
          {slide.label && (
            <motion.p
              variants={shouldReduceMotion ? undefined : revealItemVariants}
              className="text-[clamp(1rem,2vw,1.75rem)] font-bold leading-tight"
            >
              {slide.label}
            </motion.p>
          )}
          <motion.h1
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className="mt-[clamp(0.45rem,1.4vw,1rem)] text-[clamp(2.1rem,5.6vw,4.9rem)] font-black leading-[1.05]"
          >
            {slide.title}
          </motion.h1>
          {slide.subtitle && (
            <motion.p
              variants={shouldReduceMotion ? undefined : revealItemVariants}
              className="mt-[clamp(0.85rem,2vw,1.75rem)] text-[clamp(1.05rem,2.1vw,1.75rem)] font-bold leading-tight"
            >
              {slide.subtitle}
            </motion.p>
          )}
        </motion.div>
      </motion.div>
    </SlideShell>
  );
}

function OutlineSlide({ slide }: LessonSlideRendererProps) {
  const cardCount = slide.cards?.length || 0;
  const isCompact = cardCount > 2;
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className={cn(
          'mx-auto flex h-full w-full flex-col justify-center',
          isCompact ? 'max-w-[72rem]' : 'max-w-[58rem]'
        )}
      >
        <motion.header
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className="text-center"
        >
          <motion.h1
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className={cn(
              'font-black leading-none text-[#4d46e8] dark:text-indigo-300',
              isCompact
                ? 'text-[clamp(1.65rem,3.2vw,3.05rem)]'
                : 'text-[clamp(2.1rem,4.4vw,4.2rem)]'
            )}
          >
            {slide.title}
          </motion.h1>
          {slide.subtitle && (
            <motion.p
              variants={shouldReduceMotion ? undefined : revealItemVariants}
              className={cn(
                'mt-[clamp(0.25rem,0.8vw,0.65rem)] font-black leading-tight text-[#e52d83] dark:text-pink-300',
                isCompact ? 'text-[clamp(1.1rem,2.25vw,2rem)]' : 'text-[clamp(1.35rem,3vw,2.4rem)]'
              )}
            >
              {slide.subtitle}
            </motion.p>
          )}
        </motion.header>

        <motion.div
          variants={shouldReduceMotion ? undefined : scaleRevealVariants}
          className={cn(
            'rounded-[clamp(1rem,2vw,1.75rem)] border border-white/90 bg-white/70 shadow-[0_22px_48px_rgba(74,85,104,0.2)] backdrop-blur-sm dark:border-slate-600/80 dark:bg-slate-900/85 dark:shadow-none',
            isCompact
              ? 'mt-[clamp(0.85rem,2vw,1.4rem)] p-[clamp(0.85rem,2vw,1.45rem)]'
              : 'mt-[clamp(1.5rem,4vw,3rem)] p-[clamp(1.1rem,3vw,2.25rem)]'
          )}
        >
          {slide.label && (
            <h2
              className={cn(
                'font-black text-[#302b7d] dark:text-indigo-200',
                isCompact
                  ? 'text-[clamp(0.85rem,1.45vw,1.25rem)]'
                  : 'text-[clamp(1rem,2vw,1.75rem)]'
              )}
            >
              {slide.label}
            </h2>
          )}
          <motion.div
            variants={shouldReduceMotion ? undefined : revealContainerVariants}
            className={cn(
              'border-t border-[#c7d8ff] dark:border-blue-400/35',
              isCompact
                ? 'mt-[clamp(0.55rem,1.1vw,0.85rem)] grid gap-[clamp(0.55rem,1.1vw,0.85rem)] pt-[clamp(0.65rem,1.3vw,1rem)] md:grid-cols-2'
                : 'mt-[clamp(0.8rem,2vw,1.5rem)] space-y-[clamp(0.8rem,1.6vw,1.5rem)] pt-[clamp(0.9rem,2vw,1.5rem)]'
            )}
          >
            {(slide.cards || []).map((card, index) => {
              const accent = getAccent(card.accent || (index % 2 === 0 ? 'orange' : 'pink'));

              return (
                <motion.article
                  key={`${slide.id}-${card.title}`}
                  variants={shouldReduceMotion ? undefined : scaleRevealVariants}
                  whileHover={shouldReduceMotion ? undefined : { y: -3, scale: 1.01 }}
                  className={cn(
                    'flex items-center rounded-[clamp(0.75rem,1.5vw,1.25rem)] bg-gradient-to-r text-white shadow-[0_10px_22px_rgba(190,82,79,0.18)]',
                    isCompact
                      ? 'gap-[clamp(0.55rem,1.1vw,0.9rem)] px-[clamp(0.75rem,1.6vw,1.25rem)] py-[clamp(0.65rem,1.35vw,1rem)]'
                      : 'gap-[clamp(0.8rem,2vw,1.4rem)] px-[clamp(1rem,2.6vw,1.9rem)] py-[clamp(0.85rem,2vw,1.45rem)]',
                    accent.gradient
                  )}
                >
                  <span
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-full bg-white/28 font-black',
                      isCompact
                        ? 'h-[clamp(1.75rem,3vw,2.45rem)] w-[clamp(1.75rem,3vw,2.45rem)] text-[clamp(0.85rem,1.5vw,1.15rem)]'
                        : 'h-[clamp(2.1rem,4vw,3.3rem)] w-[clamp(2.1rem,4vw,3.3rem)] text-[clamp(1rem,2vw,1.55rem)]'
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <h3
                      className={cn(
                        'font-black leading-tight',
                        isCompact
                          ? 'text-[clamp(0.9rem,1.65vw,1.3rem)]'
                          : 'text-[clamp(1.05rem,2.3vw,1.75rem)]'
                      )}
                    >
                      {card.title}
                    </h3>
                    {(card.subtitle || card.content) && (
                      <p
                        className={cn(
                          'mt-1 font-semibold leading-tight text-white/92',
                          isCompact
                            ? 'text-[clamp(0.8rem,1.35vw,1.05rem)]'
                            : 'text-[clamp(0.9rem,1.8vw,1.45rem)]'
                        )}
                      >
                        {card.subtitle || renderRichText(card.content)}
                      </p>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </motion.div>
        </motion.div>
      </motion.div>
    </SlideShell>
  );
}

function ObjectivesSlide({ slide }: LessonSlideRendererProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className="flex h-full flex-col justify-center"
      >
        <motion.h1
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className="text-center text-[clamp(2rem,4vw,3.6rem)] font-black text-[#4d46e8] dark:text-indigo-300"
        >
          {slide.title}
        </motion.h1>
        <motion.div
          variants={shouldReduceMotion ? undefined : scaleRevealVariants}
          className="mx-auto mt-[clamp(1.25rem,3vw,2rem)] w-full max-w-[76rem] rounded-[clamp(1.2rem,2.4vw,2rem)] bg-[#dfeaff]/88 px-[clamp(1.3rem,5vw,4.5rem)] py-[clamp(1.4rem,4vw,3.2rem)] shadow-[0_16px_34px_rgba(88,91,118,0.16)] dark:bg-slate-900/80 dark:shadow-none"
        >
          <BulletList
            items={slide.bullets}
            className="text-[clamp(1.15rem,2.35vw,2rem)] font-medium leading-[1.38]"
          />
        </motion.div>
      </motion.div>
    </SlideShell>
  );
}

function CardsSlide({ slide }: LessonSlideRendererProps) {
  const cardCount = slide.cards?.length || 0;
  const maxBulletCount = Math.max(
    ...(slide.cards || []).map((card) => card.bullets?.length || 0),
    0
  );
  const isCompact = cardCount >= 4 && maxBulletCount >= 4;
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className="flex min-h-0 flex-1 flex-col"
      >
        <motion.h1
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className={cn(
            'font-black leading-tight',
            isCompact ? 'text-[clamp(1.35rem,2.5vw,2.25rem)]' : 'text-[clamp(1.6rem,3vw,2.8rem)]',
            getAccent(slide.accent || 'blue').text
          )}
        >
          {slide.title}
        </motion.h1>
        {slide.subtitle && (
          <motion.p
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className={cn(
              'mt-1 font-bold text-slate-600 dark:text-slate-300',
              isCompact
                ? 'text-[clamp(0.88rem,1.35vw,1.08rem)]'
                : 'text-[clamp(0.9rem,1.4vw,1.2rem)]'
            )}
          >
            {slide.subtitle}
          </motion.p>
        )}
        <motion.div
          variants={shouldReduceMotion ? undefined : revealContainerVariants}
          className={cn(
            'grid min-h-0 flex-1 md:grid-cols-2',
            isCompact
              ? 'mt-[clamp(0.55rem,1.15vw,0.9rem)] gap-[clamp(0.55rem,1.05vw,0.8rem)]'
              : 'mt-[clamp(0.8rem,2vw,1.5rem)] gap-[clamp(0.7rem,1.5vw,1rem)]'
          )}
        >
          {(slide.cards || []).map((card, index) => {
            const accent = getAccent(
              card.accent || (['red', 'blue', 'green', 'purple'][index] as LessonSlideAccent)
            );

            return (
              <motion.article
                key={`${slide.id}-${card.title}`}
                variants={shouldReduceMotion ? undefined : scaleRevealVariants}
                whileHover={shouldReduceMotion ? undefined : { y: -3, scale: 1.01 }}
                className={cn(
                  'flex min-h-0 flex-col overflow-hidden rounded-[clamp(0.8rem,1.5vw,1.1rem)] border-l-[4px] bg-white/84 shadow-[0_10px_22px_rgba(89,88,112,0.16)] dark:bg-slate-800/90 dark:shadow-none',
                  isCompact
                    ? 'px-[clamp(0.9rem,1.8vw,1.25rem)] py-[clamp(0.75rem,1.35vw,1rem)]'
                    : 'px-[clamp(0.9rem,2vw,1.35rem)] py-[clamp(0.85rem,1.8vw,1.2rem)]',
                  accent.border
                )}
              >
                <h2
                  className={cn(
                    'font-black leading-tight',
                    isCompact
                      ? 'text-[clamp(1.05rem,1.85vw,1.45rem)]'
                      : 'text-[clamp(1.05rem,2vw,1.6rem)]',
                    accent.text
                  )}
                >
                  {card.title}
                </h2>
                {card.subtitle && (
                  <p
                    className={cn(
                      'mt-1 font-semibold text-slate-500 dark:text-slate-400',
                      isCompact
                        ? 'text-[clamp(0.8rem,1.15vw,0.95rem)]'
                        : 'text-[clamp(0.8rem,1.35vw,1rem)]'
                    )}
                  >
                    {card.subtitle}
                  </p>
                )}
                {card.content && (
                  <p
                    className={cn(
                      'leading-snug',
                      isCompact
                        ? 'mt-[clamp(0.35rem,0.8vw,0.55rem)] text-[clamp(0.9rem,1.35vw,1.1rem)]'
                        : 'mt-[clamp(0.45rem,1vw,0.8rem)] text-[clamp(0.95rem,1.7vw,1.35rem)]'
                    )}
                  >
                    {renderRichText(card.content)}
                  </p>
                )}
                <BulletList
                  items={card.bullets}
                  className={cn(
                    'font-medium leading-snug',
                    isCompact
                      ? 'mt-[clamp(0.35rem,0.75vw,0.55rem)] space-y-[clamp(0.38rem,0.75vw,0.6rem)] text-[clamp(0.95rem,1.45vw,1.18rem)]'
                      : 'mt-[clamp(0.45rem,1vw,0.8rem)] text-[clamp(0.95rem,1.7vw,1.35rem)]'
                  )}
                />
                {card.example && (
                  <motion.p
                    variants={shouldReduceMotion ? undefined : revealItemVariants}
                    className={cn(
                      'mt-auto border-t font-semibold italic text-slate-500 dark:text-slate-400',
                      isCompact
                        ? 'pt-[clamp(0.3rem,0.65vw,0.5rem)] text-[clamp(0.78rem,1.12vw,0.92rem)]'
                        : 'pt-[clamp(0.45rem,1vw,0.8rem)] text-[clamp(0.85rem,1.45vw,1.1rem)]',
                      accent.divider
                    )}
                  >
                    VD: {card.example}
                  </motion.p>
                )}
              </motion.article>
            );
          })}
        </motion.div>
      </motion.div>
    </SlideShell>
  );
}

function ExplainSlide({ slide }: LessonSlideRendererProps) {
  const accent = getAccent(slide.accent);
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className="flex min-h-0 flex-1 flex-col justify-center"
      >
        <motion.h1
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className={cn('text-[clamp(1.8rem,3.5vw,3.4rem)] font-black', accent.text)}
        >
          {slide.title}
        </motion.h1>
        {slide.subtitle && (
          <motion.p
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className="mt-1 text-[clamp(1rem,1.8vw,1.45rem)] font-bold text-slate-600 dark:text-slate-300"
          >
            {slide.subtitle}
          </motion.p>
        )}
        <motion.div
          variants={shouldReduceMotion ? undefined : revealContainerVariants}
          className="mt-[clamp(1rem,2vw,1.6rem)] grid gap-[clamp(0.8rem,1.5vw,1.2rem)] lg:grid-cols-2"
        >
          {(slide.sections || []).map((section) => {
            const sectionAccent = getAccent(section.accent || slide.accent);

            return (
              <motion.section
                key={`${slide.id}-${section.title}`}
                variants={shouldReduceMotion ? undefined : scaleRevealVariants}
                whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                className={cn(
                  'rounded-[clamp(0.9rem,1.8vw,1.4rem)] border bg-white/82 p-[clamp(1rem,2vw,1.6rem)] shadow-[0_12px_28px_rgba(79,91,121,0.14)] dark:bg-slate-800/90 dark:shadow-none',
                  sectionAccent.divider
                )}
              >
                <h2
                  className={cn(
                    'text-[clamp(1.1rem,2vw,1.7rem)] font-black leading-tight',
                    sectionAccent.text
                  )}
                >
                  {section.title}
                </h2>
                {section.subtitle && (
                  <p className="mt-1 text-[clamp(0.9rem,1.4vw,1.1rem)] font-bold text-slate-500 dark:text-slate-400">
                    {section.subtitle}
                  </p>
                )}
                {section.content && (
                  <p className="mt-[clamp(0.6rem,1.2vw,1rem)] text-[clamp(1rem,1.8vw,1.4rem)] leading-snug">
                    {renderRichText(section.content)}
                  </p>
                )}
                <BulletList
                  items={section.bullets}
                  className="mt-[clamp(0.65rem,1.4vw,1rem)] text-[clamp(0.95rem,1.65vw,1.25rem)] leading-snug"
                />
                {section.example && (
                  <motion.p
                    variants={shouldReduceMotion ? undefined : revealItemVariants}
                    className={cn(
                      'mt-[clamp(0.7rem,1.5vw,1.1rem)] rounded-xl px-4 py-3 text-[clamp(0.9rem,1.55vw,1.2rem)] font-bold italic text-slate-600 dark:text-slate-300',
                      sectionAccent.soft
                    )}
                  >
                    {section.example}
                  </motion.p>
                )}
              </motion.section>
            );
          })}
        </motion.div>
      </motion.div>
    </SlideShell>
  );
}

function PracticeSlide({ slide }: LessonSlideRendererProps) {
  const accent = getAccent(slide.accent || 'green');
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className="mx-auto flex h-full w-full max-w-[68rem] flex-col justify-center"
      >
        <motion.div
          variants={shouldReduceMotion ? undefined : scaleRevealVariants}
          className={cn(
            'rounded-[clamp(1.1rem,2.2vw,1.8rem)] border bg-white/86 p-[clamp(1.25rem,3vw,2.5rem)] shadow-[0_18px_38px_rgba(67,82,112,0.18)] dark:bg-slate-800/90 dark:shadow-none',
            accent.divider
          )}
        >
          <motion.h1
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className={cn('text-[clamp(2rem,4vw,3.6rem)] font-black', accent.text)}
          >
            {slide.title}
          </motion.h1>
          {slide.subtitle && (
            <motion.p
              variants={shouldReduceMotion ? undefined : revealItemVariants}
              className="mt-2 text-[clamp(1rem,1.8vw,1.35rem)] font-bold text-slate-600 dark:text-slate-300"
            >
              {slide.subtitle}
            </motion.p>
          )}
          <BulletList
            items={slide.bullets}
            className="mt-[clamp(1rem,2vw,1.6rem)] text-[clamp(1.1rem,2vw,1.65rem)] font-medium leading-snug"
          />
          {!!slide.examples?.length && (
            <motion.div
              variants={shouldReduceMotion ? undefined : revealContainerVariants}
              className="mt-[clamp(1rem,2vw,1.6rem)] grid gap-3 md:grid-cols-2"
            >
              {slide.examples.map((example) => (
                <motion.p
                  key={example}
                  variants={shouldReduceMotion ? undefined : revealItemVariants}
                  whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                  className={cn(
                    'rounded-xl px-4 py-3 text-[clamp(0.95rem,1.6vw,1.25rem)] font-black',
                    accent.soft,
                    accent.text
                  )}
                >
                  {example}
                </motion.p>
              ))}
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </SlideShell>
  );
}

function ImageTextSlide({ slide }: LessonSlideRendererProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className="grid h-full w-full items-center gap-[clamp(1rem,2.4vw,2rem)] lg:grid-cols-[1.05fr_0.95fr]"
      >
        <motion.div
          variants={shouldReduceMotion ? undefined : scaleRevealVariants}
          className="aspect-[4/3] overflow-hidden rounded-[clamp(1rem,2vw,1.75rem)] border border-white/90 bg-white/70 shadow-[0_20px_42px_rgba(79,91,121,0.18)] dark:border-slate-600/80 dark:bg-slate-900/85 dark:shadow-none lg:aspect-[16/11]"
        >
          {slide.imageUrl ? (
            <motion.img
              src={slide.imageUrl}
              alt=""
              variants={shouldReduceMotion ? undefined : revealItemVariants}
              className="h-full max-h-[68vh] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-slate-400">
              <Image className="h-16 w-16" />
            </div>
          )}
        </motion.div>
        <motion.div variants={shouldReduceMotion ? undefined : revealContainerVariants}>
          <motion.p
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className={cn(
              'text-[clamp(0.9rem,1.4vw,1.1rem)] font-black',
              getAccent(slide.accent).text
            )}
          >
            {slide.label || 'Explore'}
          </motion.p>
          <motion.h1
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className="mt-2 text-[clamp(2rem,4vw,3.8rem)] font-black leading-tight text-slate-950 dark:text-slate-50"
          >
            {slide.title}
          </motion.h1>
          {slide.text && (
            <motion.p
              variants={shouldReduceMotion ? undefined : revealItemVariants}
              className="mt-[clamp(0.8rem,2vw,1.5rem)] text-[clamp(1.05rem,2vw,1.65rem)] font-medium leading-snug text-slate-600 dark:text-slate-300"
            >
              {slide.text}
            </motion.p>
          )}
        </motion.div>
      </motion.div>
    </SlideShell>
  );
}

function AudioTextSlide({ slide }: LessonSlideRendererProps) {
  const accent = getAccent(slide.accent);
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className="mx-auto flex h-full w-full max-w-[56rem] flex-col justify-center text-center"
      >
        <motion.div
          variants={shouldReduceMotion ? undefined : scaleRevealVariants}
          animate={
            slide.audioUrl && !shouldReduceMotion
              ? {
                  scale: [1, 1.035, 1],
                  boxShadow: [
                    '0 0 0 0 rgba(77,70,232,0.0)',
                    '0 0 0 10px rgba(77,70,232,0.08)',
                    '0 0 0 0 rgba(77,70,232,0.0)',
                  ],
                }
              : undefined
          }
          transition={
            slide.audioUrl && !shouldReduceMotion
              ? { duration: 2.2, ease: 'easeInOut', repeat: Infinity }
              : undefined
          }
          className={cn(
            'mx-auto flex h-[clamp(4.5rem,9vw,7rem)] w-[clamp(4.5rem,9vw,7rem)] items-center justify-center rounded-[clamp(1rem,2vw,1.7rem)]',
            accent.soft,
            accent.text
          )}
        >
          <Volume2 className="h-1/2 w-1/2" />
        </motion.div>
        <motion.p
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className={cn('mt-6 text-[clamp(0.9rem,1.4vw,1.15rem)] font-black', accent.text)}
        >
          {slide.label || 'Listen'}
        </motion.p>
        <motion.h1
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className="mt-2 text-[clamp(2rem,4.5vw,4.2rem)] font-black leading-tight"
        >
          {slide.title}
        </motion.h1>
        {slide.text && (
          <motion.p
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className="mt-[clamp(0.8rem,2vw,1.5rem)] text-[clamp(1rem,2vw,1.55rem)] font-medium leading-snug text-slate-600 dark:text-slate-300"
          >
            {slide.text}
          </motion.p>
        )}
        {slide.audioUrl ? (
          <motion.audio
            controls
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className="mx-auto mt-8 w-full max-w-2xl"
          >
            <source src={slide.audioUrl} />
          </motion.audio>
        ) : (
          <motion.div
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className="mx-auto mt-8 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-4 text-sm font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-400"
          >
            Audio will appear here when an audio file is configured.
          </motion.div>
        )}
      </motion.div>
    </SlideShell>
  );
}

function TitleContentSlide({ slide }: LessonSlideRendererProps) {
  const accent = getAccent(slide.accent);
  const shouldReduceMotion = useReducedMotion();

  return (
    <SlideShell slide={slide}>
      <motion.div
        variants={shouldReduceMotion ? undefined : revealContainerVariants}
        className={cn(
          'mx-auto flex h-full w-full max-w-[62rem] flex-col justify-center',
          slide.text && slide.text.length < 180 ? 'text-center' : 'text-left'
        )}
      >
        <motion.p
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className={cn('text-[clamp(0.9rem,1.4vw,1.15rem)] font-black', accent.text)}
        >
          {slide.label || 'Lesson'}
        </motion.p>
        <motion.h1
          variants={shouldReduceMotion ? undefined : revealItemVariants}
          className="mt-2 text-[clamp(2.2rem,5vw,4.8rem)] font-black leading-tight text-slate-950 dark:text-slate-50"
        >
          {slide.title}
        </motion.h1>
        {slide.text && (
          <motion.p
            variants={shouldReduceMotion ? undefined : revealItemVariants}
            className="mt-[clamp(1rem,2.2vw,1.8rem)] text-[clamp(1.05rem,2.1vw,1.65rem)] font-medium leading-snug text-slate-600 dark:text-slate-300"
          >
            {slide.text}
          </motion.p>
        )}
      </motion.div>
    </SlideShell>
  );
}

export default function LessonSlideRenderer({ slide }: LessonSlideRendererProps) {
  if (slide.layout === 'cover' || slide.layout === 'section-cover') {
    return <CoverSlide slide={slide} />;
  }

  if (slide.layout === 'outline') {
    return <OutlineSlide slide={slide} />;
  }

  if (slide.layout === 'objectives') {
    return <ObjectivesSlide slide={slide} />;
  }

  if (slide.layout === 'cards') {
    return <CardsSlide slide={slide} />;
  }

  if (slide.layout === 'explain') {
    return <ExplainSlide slide={slide} />;
  }

  if (slide.layout === 'practice') {
    return <PracticeSlide slide={slide} />;
  }

  if (slide.layout === 'image-text') {
    return <ImageTextSlide slide={slide} />;
  }

  if (slide.layout === 'audio-text') {
    return <AudioTextSlide slide={slide} />;
  }

  return <TitleContentSlide slide={slide} />;
}
