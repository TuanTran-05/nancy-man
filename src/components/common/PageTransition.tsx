import React from 'react';
import { motion } from 'framer-motion';
import { useMotionSafe } from '../../hooks/useMotionSafe';

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export default function PageTransition({ children, className = '' }: PageTransitionProps) {
  const { pageVariants, pageTransition } = useMotionSafe();

  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageVariants}
      transition={pageTransition}
      className={`w-full h-full ${className}`}
      style={{ willChange: 'opacity, transform' }}
    >
      {children}
    </motion.div>
  );
}
