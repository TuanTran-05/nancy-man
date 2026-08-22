import React from 'react';
import { motion } from 'framer-motion';
import { CENTER_LOGO_URL } from '../../lib/brand';
import { useLanguage } from '../../lib/i18n/useLanguage';

export default function LoadingScreen() {
  const { t } = useLanguage();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center z-[200]"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center"
      >
        <motion.div
          animate={{
            scale: [0.95, 1, 0.95],
            boxShadow: [
              '0 20px 25px -5px rgba(59, 130, 246, 0.1)',
              '0 25px 35px -5px rgba(59, 130, 246, 0.3)',
              '0 20px 25px -5px rgba(59, 130, 246, 0.1)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-20 h-20 bg-white dark:bg-slate-800 rounded-3xl flex items-center justify-center shadow-xl mb-8 border border-slate-100 dark:border-slate-700"
        >
          <img
            src={CENTER_LOGO_URL}
            alt="Thiên Uy English Center"
            className="w-14 h-14 object-contain"
          />
        </motion.div>

        <h2 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100 mb-2 tracking-tight">
          EduTrack
        </h2>
        <p className="text-slate-500 dark:text-slate-400 font-medium mb-6">
          {t.loadingScreen.loading}
        </p>

        <div className="flex space-x-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{
                y: [0, -10, 0],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.15,
                ease: 'easeInOut',
              }}
              className="w-2.5 h-2.5 bg-blue-600 rounded-full"
            />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
