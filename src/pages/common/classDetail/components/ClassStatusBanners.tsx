import { AlertCircle, Clock, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '../../../../lib/i18n/useLanguage';

type ClassStatusBannersProps = {
  isArchived: boolean;
  isPaused: boolean;
  isExpired: boolean;
  isAdmin: boolean;
  onStartNewCourse: () => void;
};

export function ClassStatusBanners({
  isArchived,
  isPaused,
  isExpired,
  isAdmin,
  onStartNewCourse,
}: ClassStatusBannersProps) {
  const { t } = useLanguage();
  return (
    <>
      {/* Status Warning */}
      {isArchived && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-100 border border-border-default p-4 rounded-2xl flex items-center gap-4"
        >
          <div className="flex items-center space-x-3 text-slate-600">
            <Lock className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-bold">{t.classStatusBanners.archivedTitle}</p>
              <p className="text-sm opacity-90">{t.classStatusBanners.archivedDesc}</p>
            </div>
          </div>
        </motion.div>
      )}

      {isPaused && !isArchived && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 p-4 rounded-2xl flex items-center gap-4"
        >
          <div className="flex items-center space-x-3 text-amber-800">
            <Clock className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-bold">{t.classStatusBanners.pausedTitle}</p>
              <p className="text-sm opacity-90">{t.classStatusBanners.pausedDesc}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Expiration Warning */}
      {isExpired && !isArchived && !isPaused && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 p-4 rounded-2xl flex items-center justify-between gap-4"
        >
          <div className="flex items-center space-x-3 text-amber-800">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-bold">{t.classStatusBanners.courseEndedTitle}</p>
              <p className="text-sm opacity-90">
                {isAdmin
                  ? t.classStatusBanners.courseEndedAdmin
                  : t.classStatusBanners.courseEndedTeacher}
              </p>
            </div>
          </div>
          {isAdmin ? (
            <button
              onClick={onStartNewCourse}
              className="whitespace-nowrap bg-amber-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-amber-700 transition-colors shadow-lg shadow-amber-200"
            >
              {t.classStatusBanners.startNewCourse}
            </button>
          ) : (
            <div className="flex items-center space-x-2 text-amber-600 bg-amber-100/50 px-3 py-1.5 rounded-lg border border-amber-200">
              <span className="text-xs font-bold uppercase tracking-wider">
                {t.classStatusBanners.waitingAdminReset}
              </span>
            </div>
          )}
        </motion.div>
      )}
    </>
  );
}
