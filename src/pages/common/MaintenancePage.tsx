import { Clock, Settings, ShieldCheck } from 'lucide-react';
import { MAINTENANCE_WINDOW_LABEL } from '../../app/maintenanceMode';
import { CENTER_LOGO_URL } from '../../lib/brand';

export default function MaintenancePage() {
  return (
    <main className="min-h-[100dvh] bg-[#f6f8fb] text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <img
        src={CENTER_LOGO_URL}
        alt="Thiên Uy English Center"
        data-testid="maintenance-logo"
        className="fixed right-4 top-4 z-10 h-auto w-20 object-contain sm:right-8 sm:top-8 sm:w-28 lg:w-36"
      />
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col justify-center px-5 py-10 sm:px-8">
        <section className="grid items-center gap-8 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-800 shadow-sm dark:border-sky-500/30 dark:bg-slate-900/90 dark:text-sky-300">
              <Settings className="h-4 w-4" aria-hidden="true" />
              Đang cập nhật hệ thống
            </div>

            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-black leading-tight text-slate-950 dark:text-slate-50 sm:text-5xl lg:text-6xl">
                Hệ thống đang bảo trì
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300 sm:text-xl">
                EduTrack tạm ngưng truy cập để nâng cấp dữ liệu và kiểm tra ổn định. Vui lòng quay
                lại sau khi quá trình cập nhật hoàn tất.
              </p>
            </div>

            <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:shadow-none">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                  <Clock className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold uppercase text-slate-500">Thời gian bảo trì</p>
                <p className="mt-2 text-base font-bold text-slate-950">
                  {MAINTENANCE_WINDOW_LABEL}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:shadow-none">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold uppercase text-slate-500">Trạng thái</p>
                <p className="mt-2 text-base font-bold text-slate-950">
                  Đang cập nhật, dữ liệu được giữ an toàn
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:shadow-none sm:p-8">
            <div className="space-y-5">
              <div className="h-3 w-24 rounded-full bg-sky-600" />
              <div className="space-y-3">
                <div className="h-4 rounded-full bg-slate-200" />
                <div className="h-4 w-5/6 rounded-full bg-slate-200" />
                <div className="h-4 w-2/3 rounded-full bg-slate-200" />
              </div>
              <div className="grid gap-3 pt-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
                  <p className="text-sm font-semibold text-slate-900">Nâng cấp hệ thống</p>
                  <p className="mt-1 text-sm text-slate-600">Đang xử lý các cập nhật cần thiết.</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
                  <p className="text-sm font-semibold text-slate-900">Kiểm tra truy cập</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Hệ thống sẽ mở lại sau khi hoàn tất.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
