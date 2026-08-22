import React, { useCallback, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { auth } from '../../../../lib/auth/sessionAuth';
import type { Class, EnrollmentStatus, SafeStudent } from '../../../../types';
import { apiRequest } from '../../../../lib/api/apiClient';
import { isStudentFaceStoragePath } from '../../../../lib/student/faceImage';
import { uploadStudentFaceImageIfNeeded } from '../../../../lib/student/faceUpload';
import { getStudentStatusFormValue } from '../../../../lib/student/statusForm';
import { useCameraCapture } from '../../../../hooks/useCameraCapture';
import { StudentDeleteModal } from './StudentDeleteModal';
import { StudentFormModal } from './StudentFormModal';
import { StudentStatusModal } from './StudentStatusModal';
import { StudentTransferModal } from './StudentTransferModal';
import { useClosedCourseJoin } from '../../../../lib/classes/useClosedCourseJoin';

import type { StudentEditReferenceData } from '../../../../lib/student/studentActionReferenceData';

type StudentFormData = {
  name: string;
  studentId: string;
  dob: string;
  contact: string;
  classId: string;
  faceImage: string;
  faceImageStoragePath: string;
  code: string;
  gender: 'male' | 'female' | 'other' | '';
  grade: string;
};

const EMPTY_FORM: StudentFormData = {
  name: '',
  studentId: '',
  dob: '',
  contact: '',
  classId: '',
  faceImage: '',
  faceImageStoragePath: '',
  code: '',
  gender: '',
  grade: '',
};

export interface StudentActionsController {
  openCreate(initial?: { classId?: string; fixedClass?: boolean }): void;
  openEdit(student: SafeStudent): Promise<void>;
  openStatus(student: SafeStudent): void;
  openTransfer(student: SafeStudent): void;
  openDelete(id: string): void;
}

export interface UseStudentActionModalsArgs {
  classes: Class[];
  sortedClasses: Class[];
  filterableClasses: Class[];
  teachers: { uid: string; displayName: string }[];
  resolveFaceSrc: (student: SafeStudent) => string;
  loadEditReferences?: () => Promise<StudentEditReferenceData>;
  onChanged: () => void;
  t: any;
  tc: any;
}

export function useStudentActionModals(args: UseStudentActionModalsArgs): {
  controller: StudentActionsController;
  modals: React.ReactNode;
  isAnyOpen: boolean;
} {
  const argsRef = useRef(args);
  argsRef.current = args;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<SafeStudent | null>(null);
  const [formData, setFormData] = useState<StudentFormData>(EMPTY_FORM);
  const [fixedCreateClassId, setFixedCreateClassId] = useState<string | null>(null);
  const [studentToChangeStatus, setStudentToChangeStatus] = useState<SafeStudent | null>(null);
  const [statusFormData, setStatusFormData] = useState({
    enrollmentStatus: 'active',
    statusNote: '',
  });
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [studentToTransfer, setStudentToTransfer] = useState<SafeStudent | null>(null);
  const [targetClassId, setTargetClassId] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editReferenceData, setEditReferenceData] = useState<StudentEditReferenceData | null>(null);
  const editReferenceDataRef = useRef<StudentEditReferenceData | null>(null);
  const { guard: guardClosedCourseJoin, modal: closedCourseJoinModal } = useClosedCourseJoin();

  const { videoRef, isCameraActive, startCamera, stopCamera, capturePhoto } = useCameraCapture(
    (dataUrl) => setFormData((prev) => ({ ...prev, faceImage: dataUrl })),
    args.t.messages.cameraError
  );

  const showSuccess = useCallback((msg: string) => {
    toast.success(msg);
  }, []);

  const setError = useCallback((msg: string | null) => {
    if (msg) toast.error(msg);
  }, []);

  const handleModalClose = useCallback(() => {
    stopCamera();
    setIsModalOpen(false);
    setEditingStudent(null);
    setFixedCreateClassId(null);
    setError(null);
    setFormData(EMPTY_FORM);
    setEditReferenceData(null);
    editReferenceDataRef.current = null;
  }, [setError, stopCamera]);

  const openCreate = useCallback((initial?: { classId?: string; fixedClass?: boolean }) => {
    const classId = initial?.classId ?? '';
    setEditingStudent(null);
    setFixedCreateClassId(initial?.fixedClass && classId ? classId : null);
    setFormData({ ...EMPTY_FORM, classId });
    setIsModalOpen(true);
  }, []);

  const openEdit = useCallback(async (student: SafeStudent) => {
    const { classes, resolveFaceSrc, loadEditReferences } = argsRef.current;
    let loadedReferences: StudentEditReferenceData | null = null;
    if (loadEditReferences) {
      loadedReferences = await loadEditReferences();
      setEditReferenceData(loadedReferences);
      editReferenceDataRef.current = loadedReferences;
    }
    const effectiveClasses = loadedReferences?.classes ?? classes;
    const classGrade = effectiveClasses.find((c) => c.id === student.classId)?.grade;
    setFixedCreateClassId(null);
    setEditingStudent(student);
    setFormData({
      name: student.name,
      studentId: student.studentId,
      dob: student.dob,
      contact: student.contact || '',
      classId: student.classId,
      faceImage: resolveFaceSrc(student) || student.faceImage || '',
      faceImageStoragePath:
        student.faceImageStoragePath ||
        (isStudentFaceStoragePath(student.faceImage) ? student.faceImage || '' : ''),
      code: student.code || '',
      gender: student.gender || '',
      grade: String(classGrade || student.grade || ''),
    });
    setIsModalOpen(true);
  }, []);

  const openStatus = useCallback((student: SafeStudent) => {
    setStudentToChangeStatus(student);
    setStatusFormData({
      enrollmentStatus: getStudentStatusFormValue(student),
      statusNote: student.statusNote || '',
    });
    setIsStatusModalOpen(true);
  }, []);

  const openTransfer = useCallback((student: SafeStudent) => {
    setStudentToTransfer(student);
    setTargetClassId('');
    setIsTransferModalOpen(true);
  }, []);

  const openDelete = useCallback((id: string) => {
    setStudentToDelete(id);
    setIsDeleteModalOpen(true);
  }, []);

  const controller = useMemo(
    () => ({
      openCreate,
      openEdit,
      openStatus,
      openTransfer,
      openDelete,
    }),
    [openCreate, openDelete, openEdit, openStatus, openTransfer]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!auth.currentUser || isSaving) return;

      setError(null);

      const classes = editReferenceDataRef.current?.classes ?? argsRef.current.classes;
      const { onChanged, t } = argsRef.current;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const phoneRegex = /^\+?[0-9]{9,15}$/;

      if (
        !formData.contact ||
        (!emailRegex.test(formData.contact) &&
          !phoneRegex.test(formData.contact.replace(/\s/g, '')))
      ) {
        setError(t.messages.invalidContact);
        setIsSaving(false);
        return;
      }

      const selectedClass = classes.find((c) => c.id === formData.classId);
      if (!selectedClass) {
        setError(t.messages.invalidClass);
        setIsSaving(false);
        return;
      }

      const data: Record<string, any> = {
        name: formData.name,
        studentId: editingStudent ? formData.studentId.trim().toUpperCase() : formData.studentId,
        dob: formData.dob,
        contact: formData.contact,
        classId: selectedClass.id,
        faceImage: formData.faceImage,
        faceImageStoragePath: formData.faceImageStoragePath,
        code: formData.code,
        gender: formData.gender,
      };

      if (formData.grade) {
        data.grade = Number(formData.grade);
      }

      const submitWith = async (joinedAt?: string) => {
        setIsSaving(true);
        try {
          const uploadedFace = await uploadStudentFaceImageIfNeeded(
            data.faceImage,
            editingStudent?.id || 'new',
            data.classId,
            formData.faceImageStoragePath
          );
          data.faceImage = uploadedFace.faceImage;
          if (uploadedFace.faceImageStoragePath) {
            data.faceImageStoragePath = uploadedFace.faceImageStoragePath;
          }
          const payload = { ...data, ...(joinedAt ? { joinedAt } : {}) };

          if (editingStudent) {
            // Class membership moves through the dedicated transfer endpoint,
            // which closes the source enrollment, opens the target, and rolls
            // the ledger. A profile-field update can no longer do this itself
            // -- the server refuses a classId change on this route -- so the
            // edit form issues the transfer first, then saves the rest of the
            // profile fields.
            if (data.classId !== editingStudent.classId) {
              await apiRequest('/api/v1/students/transfer', {
                method: 'POST',
                body: {
                  id: editingStudent.id,
                  targetClassId: data.classId,
                  ...(joinedAt ? { joinedAt } : {}),
                },
              });
            }
            await apiRequest('/api/v1/students/update', {
              method: 'PUT',
              body: { id: editingStudent.id, ...payload },
            });
            showSuccess(t.messages.successUpdate);
          } else {
            await apiRequest('/api/v1/students/create', {
              method: 'POST',
              body: payload,
            });
            showSuccess(t.messages.successAdd);
          }
          handleModalClose();
          onChanged();
        } catch (err: any) {
          console.error('Error saving student:', err);
          setError(
            err?.message?.includes('Duplicate') ? t.messages.duplicateId : t.messages.errorSaving
          );
        } finally {
          setIsSaving(false);
        }
      };

      const isAssigningClass = !editingStudent || editingStudent.classId !== selectedClass.id;
      if (!isAssigningClass) {
        await submitWith();
        return;
      }
      guardClosedCourseJoin(selectedClass, submitWith);
    },
    [
      editingStudent,
      formData,
      guardClosedCourseJoin,
      handleModalClose,
      isSaving,
      setError,
      showSuccess,
    ]
  );

  const handleStatusChangeSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!studentToChangeStatus || !auth.currentUser || isSaving) return;

      setIsSaving(true);
      setError(null);
      const { onChanged, t } = argsRef.current;

      try {
        const nextStatus = statusFormData.enrollmentStatus as EnrollmentStatus;
        await apiRequest('/api/v1/students/status', {
          method: 'PUT',
          body: {
            id: studentToChangeStatus.id,
            enrollmentStatus: nextStatus,
            statusNote: statusFormData.statusNote,
          },
        });
        showSuccess(t.messages.statusUpdateSuccess);
        setIsStatusModalOpen(false);
        setStudentToChangeStatus(null);
        onChanged();
      } catch (err: any) {
        console.error('Error changing status:', err);
        setError(t.messages.statusUpdateError);
      } finally {
        setIsSaving(false);
      }
    },
    [isSaving, setError, showSuccess, statusFormData, studentToChangeStatus]
  );

  const handleDelete = useCallback(async () => {
    if (!studentToDelete || isDeleting || !auth.currentUser) return;
    setIsDeleting(true);
    setError(null);
    const { onChanged, t } = argsRef.current;

    try {
      await apiRequest(`/api/v1/students/delete?id=${encodeURIComponent(studentToDelete)}`, {
        method: 'DELETE',
      });

      showSuccess(t.messages.deleteSuccess);
      setIsDeleteModalOpen(false);
      setStudentToDelete(null);
      onChanged();
    } catch (err: any) {
      console.error('Error deleting student:', err);
      if (err.message && err.message.includes('already deleted')) {
        setError(t.messages.deleteAlreadyDeleted);
      } else if (
        err.message &&
        (err.message.includes('permission') || err.message.includes('authorized'))
      ) {
        setError(t.messages.deletePermissionError);
      } else {
        setError(t.messages.deleteError);
      }
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, setError, showSuccess, studentToDelete]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        if (!file.type.startsWith('image/')) {
          toast.error(argsRef.current.t.imageFileError);
          return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 400;
            const MAX_HEIGHT = 400;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
              }
            } else if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
              setFormData((prev) => ({ ...prev, faceImage: dataUrl }));
              setError(null);
            }
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      }
    },
    [setError]
  );

  const transferSetStudents = useCallback<
    React.Dispatch<React.SetStateAction<SafeStudent[]>>
  >(() => {
    argsRef.current.onChanged();
  }, []);

  const effectiveClasses = editReferenceData?.classes ?? args.classes;
  const effectiveSortedClasses = editReferenceData?.sortedClasses ?? args.sortedClasses;
  const effectiveFilterableClasses = editReferenceData?.filterableClasses ?? args.filterableClasses;
  const effectiveTeachers = editReferenceData?.teachers ?? args.teachers;
  const { t, tc } = args;

  return {
    controller,
    isAnyOpen: isModalOpen || isStatusModalOpen || isDeleteModalOpen || isTransferModalOpen,
    modals: (
      <>
        <StudentFormModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          editingStudent={editingStudent}
          formData={formData}
          setFormData={setFormData}
          classes={effectiveClasses}
          sortedClasses={effectiveSortedClasses}
          teachers={effectiveTeachers}
          isSaving={isSaving}
          isCameraActive={isCameraActive}
          videoRef={videoRef}
          handleSubmit={handleSubmit}
          handleModalClose={handleModalClose}
          startCamera={startCamera}
          stopCamera={stopCamera}
          capturePhoto={capturePhoto}
          handleFileUpload={handleFileUpload}
          fixedClassId={fixedCreateClassId ?? undefined}
          t={t}
          tc={tc}
        />
        {closedCourseJoinModal}

        <StudentStatusModal
          isOpen={isStatusModalOpen}
          onClose={() => {
            setIsStatusModalOpen(false);
            setStudentToChangeStatus(null);
          }}
          studentToChangeStatus={studentToChangeStatus}
          statusFormData={statusFormData}
          setStatusFormData={setStatusFormData}
          handleStatusChangeSubmit={handleStatusChangeSubmit}
          isSaving={isSaving}
          t={t}
          tc={tc}
        />

        <StudentDeleteModal
          isOpen={isDeleteModalOpen}
          onClose={() => {
            setIsDeleteModalOpen(false);
            setStudentToDelete(null);
          }}
          handleDelete={handleDelete}
          isDeleting={isDeleting}
          t={t}
          tc={tc}
        />

        <StudentTransferModal
          isOpen={isTransferModalOpen}
          onClose={() => {
            setIsTransferModalOpen(false);
            setStudentToTransfer(null);
          }}
          studentToTransfer={studentToTransfer}
          targetClassId={targetClassId}
          setTargetClassId={setTargetClassId}
          isTransferring={isTransferring}
          setIsTransferring={setIsTransferring}
          classes={effectiveClasses}
          filterableClasses={effectiveFilterableClasses}
          teachers={effectiveTeachers}
          setStudents={transferSetStudents}
          tc={tc}
        />
      </>
    ),
  };
}
