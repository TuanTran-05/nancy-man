import {
  BadgeCheck,
  Bug,
  CheckCircle2,
  FileWarning,
  Lightbulb,
  Lock,
  Search,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { getBlockDevToolReturnPath } from '../../hooks/useBlockDevToolGuard';
import { CENTER_LOGO_URL } from '../../lib/brand';

const noticeRows = [
  {
    label: 'Lý do',
    text: 'Phát hiện thao tác F12 / Inspect / menu chuột phải bất thường',
    icon: Search,
    accent: 'blue',
  },
  {
    label: 'Tình trạng',
    text: 'Phiên làm việc tạm thời bị giới hạn để bảo vệ hệ thống',
    icon: Shield,
    accent: 'amber',
  },
  {
    label: 'Hướng dẫn',
    text: 'Vui lòng đóng DevTools và quay lại trang học tập để tiếp tục',
    icon: Lightbulb,
    accent: 'emerald',
  },
] as const;

const accentClasses = {
  blue: 'bg-blue-50 text-blue-600 border-blue-100 shadow-blue-100/80',
  amber: 'bg-amber-50 text-amber-600 border-amber-100 shadow-amber-100/80',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100 shadow-emerald-100/80',
};

export default function BlockDevToolPage() {
  const navigate = useNavigate();

  const returnToPreviousPage = () => {
    const returnPath = getBlockDevToolReturnPath();
    navigate(returnPath && returnPath !== '/blockdevtool' ? returnPath : '/');
  };

  return (
    <section className="relative min-h-screen overflow-hidden rounded-none px-3 py-6 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(37,99,235,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(37,99,235,0.08)_1px,transparent_1px)] bg-[size:24px_24px]" />
        <img
          src={CENTER_LOGO_URL}
          alt=""
          className="absolute right-[-40px] top-20 hidden w-80 rotate-[-8deg] opacity-[0.07] lg:block"
        />
        <div className="absolute left-[8%] top-[17%] text-4xl font-black text-blue-300">+</div>
        <div className="absolute right-[18%] top-[16%] text-2xl font-black text-orange-400">+</div>
        <div className="absolute bottom-[10%] right-[4%] text-4xl font-black text-blue-400">+</div>
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-5xl items-center justify-center">
        <div className="w-full rounded-[28px] border border-blue-200/80 bg-white/92 px-5 py-7 text-center shadow-[0_24px_80px_rgba(37,99,235,0.16)] backdrop-blur-xl sm:px-8 lg:px-16">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full bg-orange-50 px-5 py-2 text-xs font-extrabold uppercase tracking-wide text-orange-600 sm:text-sm">
            <Lock className="h-4 w-4" />
            EDU TRACK SECURITY NOTICE
          </div>

          <div className="relative mx-auto mb-4 flex h-32 w-32 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-blue-200/50 blur-xl" />
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-700 text-white shadow-xl shadow-blue-200">
              <ShieldAlert className="h-16 w-16" />
              <Bug className="absolute h-7 w-7 text-slate-900" />
            </div>
            <div className="absolute bottom-3 right-1 flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 text-xl font-black text-white shadow-lg">
              !
            </div>
          </div>

          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600">
            Biên bản số: EDU-SEC-012
          </p>
          <h1 className="mx-auto max-w-4xl text-3xl font-black tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            <span className="text-blue-600">Oops!</span> Bạn vừa chạm vào DevTools
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-sm font-semibold leading-7 text-slate-500 sm:text-base">
            Hệ thống phát hiện thao tác mở công cụ nhà phát triển bằng F12 hoặc Inspect. Để bảo vệ
            nội dung học tập và dữ liệu nội bộ, khu vực này đã được chuyển sang chế độ an toàn.
          </p>

          <div className="mx-auto mt-7 grid max-w-4xl gap-3 text-left">
            {noticeRows.map((row) => {
              const Icon = row.icon;
              return (
                <div
                  key={row.label}
                  className="grid grid-cols-[68px_1fr] overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-sm"
                >
                  <div
                    className={`flex items-center justify-center border-r ${accentClasses[row.accent]}`}
                  >
                    <Icon className="h-7 w-7" />
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-600">
                      {row.label}
                    </p>
                    <p className="mt-1 text-sm font-extrabold text-slate-900 sm:text-base">
                      {row.text}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mx-auto mt-5 flex max-w-4xl gap-4 rounded-2xl border border-orange-300 bg-orange-50/80 p-4 text-left text-orange-900 shadow-sm">
            <FileWarning className="mt-1 h-7 w-7 shrink-0 text-orange-500" />
            <div>
              <p className="text-sm font-black text-orange-600">Bằng chứng:</p>
              <p className="mt-2 text-sm font-bold leading-6">
                Hệ thống đã ghi nhận hành vi truy cập khu vực dành cho nhà phát triển. Đây chỉ là
                lớp cảnh báo giao diện, không ảnh hưởng dữ liệu học tập của bạn.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={returnToPreviousPage}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-7 text-sm font-black text-slate-800 shadow-md transition hover:bg-slate-50 active:scale-95 sm:w-auto"
            >
              <CheckCircle2 className="h-5 w-5 text-blue-600" />
              Tôi đã hiểu
            </button>
          </div>

          <div className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-slate-400">
            <BadgeCheck className="h-4 w-4" />
            EduTrack protected interface
          </div>
        </div>
      </div>
    </section>
  );
}
