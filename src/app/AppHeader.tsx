import { Menu } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import type { UserProfile } from '../types';
import { Clock } from '../components/common/Clock';
import { cn } from '../lib/core/utils';
import { useProfileFaceUrl } from './useProfileFaceUrl';

export const AppHeader = ({
  user,
  profile,
  sidebarOpen,
  setSidebarOpen,
}: {
  user: any;
  profile: UserProfile | null;
  sidebarOpen: boolean;
  setSidebarOpen: (val: boolean) => void;
}) => {
  const isTeacher = profile?.role === 'teacher';
  const isParent = profile?.role === 'parent';
  const isAdmin = profile?.role === 'admin';
  const isAccounting = profile?.role === 'accounting';
  const profileFaceUrl = useProfileFaceUrl(profile);

  return (
    <header className="h-[68px] bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between px-4 lg:px-8 shrink-0 relative z-[60]">
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className={cn(
          'p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden',
          isParent && 'hidden'
        )}
      >
        <Menu className="w-5 h-5 text-slate-500" />
      </motion.button>
      <div className="flex items-center gap-3 ml-auto">
        <div className="hidden md:flex items-center bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 px-4 py-2 rounded-full text-sm font-medium">
          <Clock />
        </div>

        <Link
          to="/profile"
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold border-2 border-white dark:border-slate-800 shadow-sm overflow-hidden transition-transform hover:scale-105 active:scale-95',
            !profileFaceUrl &&
              (isAdmin
                ? 'bg-slate-700'
                : isTeacher
                  ? 'bg-blue-600'
                  : isParent
                    ? 'bg-amber-600'
                    : isAccounting
                      ? 'bg-rose-600'
                      : 'bg-emerald-600')
          )}
        >
          {profileFaceUrl ? (
            <img src={profileFaceUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            (profile?.displayName || user?.email || '?')[0].toUpperCase()
          )}
        </Link>
      </div>
    </header>
  );
};
