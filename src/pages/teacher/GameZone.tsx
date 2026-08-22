import React from 'react';
import { Link } from 'react-router';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { Gamepad2, Rocket, Star, Trophy } from 'lucide-react';

export default function GameZone() {
  const { language } = useLanguage();
  const t = translations[language].gameZone;

  return (
    <div className="min-h-full bg-slate-950 p-6 md:p-8 rounded-2xl border border-slate-700/50 shadow-2xl relative overflow-hidden">
      {/* Space Background Effect */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-10 left-10 text-white">
          <Star size={24} />
        </div>
        <div className="absolute top-1/4 right-1/4 text-white">
          <Star size={16} />
        </div>
        <div className="absolute bottom-1/3 left-1/3 text-white">
          <Star size={20} />
        </div>
        <div className="absolute top-20 right-20 text-white">
          <Star size={32} />
        </div>
      </div>

      <div className="relative z-10 space-y-8">
        <div className="flex items-center space-x-4">
          <div className="p-4 bg-blue-900/50 rounded-xl border border-blue-500/50 text-blue-300">
            <Gamepad2 size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">{t.title}</h1>
            <p className="text-subtle mt-1">{t.desc}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Lucky Lens Game Card */}
          <Link
            to="/lucky-lens"
            className="group bg-slate-900 p-6 rounded-2xl border border-slate-700 shadow-lg flex flex-col items-center text-center transition-all hover:border-blue-500 hover:shadow-blue-500/20"
          >
            <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6 text-blue-400 group-hover:scale-110 transition-transform">
              <Rocket size={40} />
            </div>
            <h3 className="font-bold text-xl text-white mb-2">Lucky Lens</h3>
            <p className="text-muted text-sm">{t.luckyLensDesc}</p>
          </Link>

          {/* Lucky Wheel Game Card */}
          <Link
            to="/lucky-wheel"
            className="group bg-slate-900 p-6 rounded-2xl border border-slate-700 shadow-lg flex flex-col items-center text-center transition-all hover:border-pink-500 hover:shadow-pink-500/20"
          >
            <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6 text-pink-400 group-hover:scale-110 transition-transform">
              <Star size={40} />
            </div>
            <h3 className="font-bold text-xl text-white mb-2">Lucky Wheel</h3>
            <p className="text-muted text-sm">{t.luckyWheelDesc}</p>
          </Link>

          {/* Placeholder Game Card */}
          <div className="group bg-slate-900 p-6 rounded-2xl border border-slate-700 shadow-lg flex flex-col items-center text-center transition-all hover:border-slate-500 hover:shadow-slate-500/20 opacity-50 cursor-not-allowed">
            <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6 text-muted">
              <Trophy size={40} />
            </div>
            <h3 className="font-bold text-xl text-white mb-2">{t.comingSoon}</h3>
            <p className="text-muted text-sm">{t.placeholderDesc}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
