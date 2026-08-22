import { describe, expect, it } from 'vitest';
import { getCurrentClassStudentRecords, getCurrentStudentRecords } from './currentRecords';

describe('getCurrentStudentRecords', () => {
  it('hides promoted records that share an active student code', () => {
    const records = getCurrentStudentRecords([
      { studentId: 'HS260001', enrollmentStatus: 'promoted', name: 'A', dob: '2014-01-01' },
      { studentId: 'HS260001', enrollmentStatus: 'active', name: 'A', dob: '2014-01-01' },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].enrollmentStatus).toBe('active');
  });

  it('hides promoted records that share active identity after ID standardization', () => {
    const records = getCurrentStudentRecords([
      {
        studentId: 'HS260001',
        enrollmentStatus: 'promoted',
        name: 'Anh Thu',
        dob: '2014-03-17',
        contact: '0964050327',
      },
      {
        studentId: 'HS260128',
        enrollmentStatus: 'active',
        name: 'Anh Thu',
        dob: '2014-03-17',
        contact: '0964050327',
      },
      {
        studentId: 'HS260129',
        enrollmentStatus: 'on_leave',
        name: 'Other',
        dob: '2012-01-01',
        contact: '0900000000',
      },
    ]);

    expect(records.map((record) => record.studentId)).toEqual(['HS260128', 'HS260129']);
  });

  it('keeps promoted records when no active matching student exists', () => {
    const records = getCurrentStudentRecords([
      {
        studentId: 'HS260001',
        enrollmentStatus: 'promoted',
        name: 'Only History',
        dob: '2014-01-01',
        contact: '0900000000',
      },
    ]);

    expect(records).toHaveLength(1);
  });

  it('deduplicates repeated active records by identity and keeps the lower student code', () => {
    const records = getCurrentStudentRecords([
      {
        studentId: 'HS260223',
        enrollmentStatus: 'active',
        name: 'Tuan Minh',
        dob: '2014-04-30',
        contact: '0963036711',
      },
      {
        studentId: 'HS260107',
        enrollmentStatus: 'active',
        name: 'Tuan Minh',
        dob: '2014-04-30',
        contact: '0963036711',
      },
    ]);

    expect(records.map((record) => record.studentId)).toEqual(['HS260107']);
  });

  it('keeps trial records as current instead of archived history', () => {
    const records = getCurrentStudentRecords([
      {
        studentId: 'HS260001',
        studentLifecycle: 'archived',
        name: 'A',
        dob: '2014-01-01',
        contact: '0900000000',
      },
      {
        studentId: 'HS260002',
        studentLifecycle: 'trial',
        name: 'A',
        dob: '2014-01-01',
        contact: '0900000000',
      },
    ]);

    expect(records.map((record) => record.studentId)).toEqual(['HS260002']);
  });

  it('builds a current class roster without duplicate active identity records', () => {
    const records = getCurrentClassStudentRecords(
      [
        {
          id: 'newer-duplicate',
          classId: 'class-1',
          studentId: 'HS260322',
          enrollmentStatus: 'active',
          name: 'Che Tran An Nhien',
          dob: '2014-03-17',
          contact: '0964050327',
        },
        {
          id: 'current-record',
          classId: 'class-1',
          studentId: 'HS260319',
          enrollmentStatus: 'active',
          name: 'Che Tran An Nhien',
          dob: '2014-03-17',
          contact: '0964050327',
        },
        {
          id: 'promoted-history',
          classId: 'class-1',
          studentId: 'HS260321',
          enrollmentStatus: 'promoted',
          name: 'Mai Thi Thien Kim',
          dob: '2014-04-20',
          contact: '0900000000',
        },
        {
          id: 'current-kim',
          classId: 'class-1',
          studentId: 'HS260316',
          enrollmentStatus: 'active',
          name: 'Mai Thi Thien Kim',
          dob: '2014-04-20',
          contact: '0900000000',
        },
        {
          id: 'other-class',
          classId: 'class-2',
          studentId: 'HS260999',
          enrollmentStatus: 'active',
          name: 'Other Class',
          dob: '2014-01-01',
          contact: '0911111111',
        },
      ] as any[],
      'class-1'
    );

    expect(records.map((record) => record.studentId)).toEqual(['HS260319', 'HS260316']);
  });
});
