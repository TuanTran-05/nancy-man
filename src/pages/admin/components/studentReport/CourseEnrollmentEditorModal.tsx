import React, { useEffect, useState } from 'react';
import type { StudentCourseEnrollmentStatus } from '../../../../../shared/studentCourseEnrollment';
import type { StudentCourseEnrollmentView } from '../../../../../shared/accountingStudentFinance';

type Props = {
  open: boolean;
  enrollment: StudentCourseEnrollmentView | null;
  role?: string;
  onClose: () => void;
  onSave: (input: {
    status: StudentCourseEnrollmentStatus;
    joinedAt: string;
    endedAt: string | null;
    statusReason: string;
  }) => Promise<void>;
};

const STATUSES: StudentCourseEnrollmentStatus[] = [
  'trial',
  'active',
  'on_leave',
  'completed',
  'transferred',
  'dropped',
];

export function CourseEnrollmentEditorModal({ open, enrollment, role, onClose, onSave }: Props) {
  const [status, setStatus] = useState<StudentCourseEnrollmentStatus>(
    enrollment?.status || 'active'
  );
  const [joinedAt, setJoinedAt] = useState(enrollment?.joinedAt || '');
  const [endedAt, setEndedAt] = useState(enrollment?.endedAt || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!enrollment) return;
    setStatus(enrollment.status);
    setJoinedAt(enrollment.joinedAt);
    setEndedAt(enrollment.endedAt || '');
    setReason('');
  }, [enrollment]);
  if (!open || !enrollment || !['admin', 'office'].includes(role || '')) return null;
  const submit = async () => {
    const normalizedReason = reason.trim();
    if (!normalizedReason || !joinedAt || (endedAt && endedAt < joinedAt)) return;
    setSaving(true);
    try {
      await onSave({ status, joinedAt, endedAt: endedAt || null, statusReason: normalizedReason });
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Chỉnh sửa enrollment</h2>
        <label className="mt-4 block text-sm">
          Trạng thái
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as StudentCourseEnrollmentStatus)}
            className="mt-1 w-full rounded border p-2"
          >
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm">
          Lý do (bắt buộc)
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded border p-2"
            rows={3}
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm">
            Ngày bắt đầu
            <input
              type="date"
              value={joinedAt}
              onChange={(event) => setJoinedAt(event.target.value)}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label className="text-sm">
            Ngày kết thúc
            <input
              type="date"
              value={endedAt}
              onChange={(event) => setEndedAt(event.target.value)}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-2">
            Hủy
          </button>
          <button
            type="button"
            disabled={
              saving || !reason.trim() || !joinedAt || Boolean(endedAt && endedAt < joinedAt)
            }
            onClick={() => void submit()}
            className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-50"
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
}
