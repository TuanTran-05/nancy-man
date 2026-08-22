import React from 'react';
import { motion, Variants } from 'framer-motion';
import { cn } from '../../../lib/core/utils';
import { AnimatedCounter } from '../../../components/common/AnimatedCounter';

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor?: string;
}

// Smart helper to render values with high-performance count-up animations
function renderValue(value: string | number) {
  if (typeof value === 'number') {
    return <AnimatedCounter value={value} />;
  }

  const str = value.toString().trim();

  // Case: percentage "85%"
  if (str.endsWith('%')) {
    const num = Number(str.slice(0, -1));
    if (!isNaN(num)) {
      return (
        <>
          <AnimatedCounter value={num} />%
        </>
      );
    }
  }

  // Case: fractions "8 / 10" or "8/10"
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 2) {
      const num1 = Number(parts[0].trim());
      const num2 = Number(parts[1].trim());
      if (!isNaN(num1) && !isNaN(num2)) {
        return (
          <>
            <AnimatedCounter value={num1} /> / <AnimatedCounter value={num2} />
          </>
        );
      }
    }
  }

  // Case: pure numeric string e.g. "123"
  const num = Number(str);
  if (!isNaN(num)) {
    return <AnimatedCounter value={num} />;
  }

  return value;
}

export function StatCard({ title, value, subtitle, icon: Icon, color, bgColor }: StatCardProps) {
  // Determine premium dynamic colored glow shadow on hover based on card's theme color
  let shadowColor = 'rgba(59, 130, 246, 0.12)';
  if (color.includes('green') || color.includes('emerald')) {
    shadowColor = 'rgba(16, 185, 129, 0.12)';
  } else if (color.includes('amber') || color.includes('orange') || color.includes('yellow')) {
    shadowColor = 'rgba(245, 158, 11, 0.12)';
  } else if (color.includes('purple') || color.includes('violet')) {
    shadowColor = 'rgba(147, 51, 234, 0.12)';
  } else if (color.includes('rose') || color.includes('red')) {
    shadowColor = 'rgba(239, 68, 68, 0.12)';
  }

  return (
    <motion.div
      variants={itemVariants}
      whileHover={{
        y: -4,
        scale: 1.015,
        boxShadow: `0 20px 40px ${shadowColor}`,
        transition: { type: 'spring', stiffness: 400, damping: 25 },
      }}
      className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm transition-shadow flex items-start space-x-4 cursor-default"
    >
      <div
        className={cn(
          'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105',
          bgColor || 'bg-blue-50 dark:bg-blue-500/10'
        )}
      >
        <Icon className={cn('w-5 h-5', color)} />
      </div>
      <div>
        <p className="text-[13px] font-semibold text-slate-400 dark:text-slate-500">{title}</p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <p className="text-[22px] font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">
            {renderValue(value)}
          </p>
        </div>
        {subtitle && <span className="text-xs font-semibold mt-0.5 block">{subtitle}</span>}
      </div>
    </motion.div>
  );
}
