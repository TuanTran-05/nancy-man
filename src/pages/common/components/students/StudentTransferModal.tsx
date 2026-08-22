import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Info, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ModalPortal } from '../../../../components/common/ModalPortal';
import type { SafeStudent, Class } from '../../../../types';
import { transferStudent } from '../../../../lib/api/studentAdminApi';
import { formatClassNameWithTeacher } from '../../../../lib/classes/sortClasses';
import { useClosedCourseJoin } from '../../../../lib/classes/useClosedCourseJoin';
import { formatVndAmount } from '../../../../lib/core/moneyFormat';

interface StudentTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentToTransfer: SafeStudent | null;
  targetClassId: string;
  setTargetClassId: (id: string) => void;
  isTransferring: boolean;
  setIsTransferring: (v: boolean) => void;
  classes: Class[];
  filterableClasses: Class[];
  teachers: { uid: string; displayName: string }[];
  setStudents: React.Dispatch<React.SetStateAction<SafeStudent[]>>;
  tc: any;
}

export const StudentTransferModal: React.FC<StudentTransferModalProps> = ({
  isOpen,
  onClose,
  studentToTransfer,
  targetClassId,
  setTargetClassId,
  isTransferring,
  setIsTransferring,
  classes,
  filterableClasses,
  teachers,
  setStudents,
  tc,
}) => {
  const { guard: guardClosedCourseJoin, modal: closedCourseJoinModal } = useClosedCourseJoin();
  if (!isOpen || !studentToTransfer) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetClassId || isTransferring) return;
    const targetClass = classes.find((classInfo) => classInfo.id === targetClassId);
    if (!targetClass) return;

    const runTransfer = async (joinedAt?: string) => {
      setIsTransferring(true);
      try {
        const res = await transferStudent(studentToTransfer.id, targetClassId, joinedAt);
        toast.success(
          `Chuyển lớp thành công! Số dư kết chuyển: ${formatVndAmount(res.rolloverBalance)}đ`
        );
        setStudents((prev) =>
          prev.map((s) => (s.id === studentToTransfer.id ? { ...s, classId: targetClassId } : s))
        );
        onClose();
      } catch (err: any) {
        console.error('Error transferring student:', err);
        toast.error(err?.message || 'Chuyển lớp thất bại');
      } finally {
        setIsTransferring(false);
      }
    };

    guardClosedCourseJoin(targetClass, runTransfer);
  };

  return (
    <AnimatePresence>
      <ModalPortal>
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-hidden="true"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-surface rounded-3xl shadow-2xl w-full max-w-md overflow-hidden p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-heading">Chuyển Lớp Học Sinh</h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-muted" />
              </button>
            </div>

            <div className="mb-6">
              <p className="text-sm text-subtle mb-1">Học sinh:</p>
              <p className="font-bold text-heading text-lg leading-tight">
                {studentToTransfer.name}
              </p>
              <p className="text-xs text-subtle font-mono">{studentToTransfer.studentId}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-2">
                  Lớp Hiện Tại
                </label>
                <input
                  type="text"
                  disabled
                  value={
                    classes.find((c) => c.id === studentToTransfer.classId)?.name || 'Không rõ'
                  }
                  className="w-full px-4 py-2 bg-page border border-border-default rounded-xl outline-none text-muted"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-2">
                  Chọn Lớp Mới
                </label>
                <select
                  required
                  value={targetClassId}
                  onChange={(e) => setTargetClassId(e.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                >
                  <option value="">-- Chọn lớp học mới --</option>
                  {filterableClasses
                    .filter((c) => c.id !== studentToTransfer.classId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatClassNameWithTeacher(c, teachers)}
                      </option>
                    ))}
                </select>
              </div>

              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-xl p-4 text-xs text-amber-800 dark:text-amber-400 space-y-1">
                <p className="font-bold flex items-center gap-1.5 mb-1.5 text-[13px]">
                  <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                  Lưu Ý Quan Trọng khi Chuyển Lớp:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-subtle leading-relaxed">
                  <li>Sĩ số lớp cũ và lớp mới sẽ tự động điều chỉnh.</li>
                  <li>
                    Học phí đã đóng và nợ ở lớp cũ sẽ tự động được tính toán và kết chuyển sang sổ
                    học phí mới.
                  </li>
                  <li>Lịch sử điểm danh và nhận xét ở lớp cũ được giữ lại và hiển thị gộp.</li>
                </ul>
              </div>

              <div className="flex gap-3 justify-end pt-2 border-t border-border-light">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-border-default rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  {tc.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!targetClassId || isTransferring}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-100 flex items-center gap-2"
                >
                  {isTransferring ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Đang xử lý...
                    </>
                  ) : (
                    'Xác nhận Chuyển lớp'
                  )}
                </button>
              </div>
            </form>
          </motion.div>
          {closedCourseJoinModal}
        </div>
      </ModalPortal>
    </AnimatePresence>
  );
};
