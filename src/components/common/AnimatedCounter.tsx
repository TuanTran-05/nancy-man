import { useEffect, useRef } from 'react';
import { useMotionValue, useTransform, motion, animate } from 'framer-motion';
import { useReducedMotion } from 'framer-motion';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
}

export function AnimatedCounter({ value, duration = 1.2 }: AnimatedCounterProps) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));
  const ref = useRef<HTMLSpanElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const controls = animate(count, value, {
      duration: shouldReduceMotion ? 0 : duration,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [value, duration, count, shouldReduceMotion]);

  return <motion.span ref={ref}>{rounded}</motion.span>;
}
