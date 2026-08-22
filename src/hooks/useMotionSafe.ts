import { useReducedMotion, type Transition, type Variants } from 'framer-motion';

export function useMotionSafe() {
  const shouldReduceMotion = useReducedMotion();

  const pageVariants: Variants = shouldReduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { opacity: 0, y: 12, filter: 'blur(4px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
        exit: { opacity: 0, y: -8, filter: 'blur(4px)' },
      };

  const pageTransition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : {
        type: 'tween' as const,
        ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        duration: 0.4,
      };

  return {
    shouldReduceMotion,
    spring: shouldReduceMotion
      ? { type: 'tween' as const, duration: 0 }
      : { type: 'spring' as const, stiffness: 300, damping: 24 },
    fade: shouldReduceMotion ? { duration: 0 } : { duration: 0.3 },
    stagger: shouldReduceMotion ? 0 : 0.05,
    pageVariants,
    pageTransition,
  };
}
