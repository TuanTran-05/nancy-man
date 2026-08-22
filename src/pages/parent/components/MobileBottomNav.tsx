import React from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { BookOpen, Home, LineChart as LineChartIcon, User } from 'lucide-react';
import { cn } from '../../../lib/core/utils';
import { useLanguage } from '../../../lib/i18n/useLanguage';

export function MobileBottomNav({
  currentTab,
  onSelectTab,
}: {
  currentTab: string;
  language?: 'vi' | 'en';
  onSelectTab: (tab: 'home' | 'progress' | 'homework') => void;
}) {
  const { t } = useLanguage();

  const items: Array<{
    id: 'home' | 'progress' | 'homework';
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'home', label: t.parent.home, icon: Home },
    { id: 'progress', label: t.parent.progress, icon: LineChartIcon },
    { id: 'homework', label: t.parent.homework, icon: BookOpen },
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <div className="mx-3 mb-3 rounded-[28px] border border-white/70 dark:border-slate-700/60 bg-white/92 dark:bg-slate-800/95 px-4 py-3 shadow-[0_24px_60px_rgba(15,23,42,0.16)] dark:shadow-none backdrop-blur-xl">
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => {
            const isActive =
              currentTab === item.id || (item.id === 'home' && currentTab === 'home');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className="relative flex flex-col items-center justify-center gap-1 rounded-2xl py-2"
              >
                {isActive ? (
                  <motion.div
                    layoutId="parent-bottom-nav-active"
                    className="absolute inset-0 rounded-2xl bg-blue-50 dark:bg-blue-500/10"
                    transition={{ type: 'spring', bounce: 0.22, duration: 0.45 }}
                  />
                ) : null}
                <item.icon
                  className={cn(
                    'relative z-10 h-5 w-5',
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-400 dark:text-slate-500'
                  )}
                />
                {item.badge ? (
                  <span className="absolute right-3 top-1 z-20 min-w-4 rounded-full bg-orange-500 px-1 py-0.5 text-[9px] font-bold text-white">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'relative z-10 text-[10px] font-semibold',
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-500 dark:text-slate-400'
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}

          <Link
            to="/profile"
            className="relative flex flex-col items-center justify-center gap-1 rounded-2xl py-2"
          >
            <User className="h-5 w-5 text-slate-400 dark:text-slate-500" />
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {t.parent.profile}
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
