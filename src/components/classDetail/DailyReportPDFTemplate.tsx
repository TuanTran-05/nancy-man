import React from 'react';
import {
  ClipboardCheck,
  Calendar,
  Clock,
  BookOpen,
  CheckCircle2,
  Edit2,
  Info,
  X,
  Users,
} from 'lucide-react';
import { Student, Attendance } from '../../types';
import { formatVN } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';

interface DailyReportPDFTemplateProps {
  dailyReportPdfRef: React.RefObject<HTMLDivElement>;
  classData: { name: string; startTime?: string };
  students: Student[];
  attendanceData: Attendance[];
  dailyReportFormData: { date: string; generalComment: string; additionalNotes: string };
}

export const DailyReportPDFTemplate: React.FC<DailyReportPDFTemplateProps> = ({
  dailyReportPdfRef,
  classData,
  students,
  attendanceData,
  dailyReportFormData,
}) => {
  const { t } = useLanguage();
  return (
    <div className="fixed left-[-9999px] top-0">
      <div
        ref={dailyReportPdfRef}
        style={{
          width: '210mm',
          minHeight: '297mm',
          padding: '40px',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: '#f0f9ff',
          color: '#334155',
        }}
      >
        {/* Decorative elements */}
        <div
          style={{
            position: 'absolute',
            top: '40px',
            right: '40px',
            opacity: 0.5,
            color: '#fbbf24',
          }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.46 14.14 2 9.24l7.19-.61L12 2 14.81 8.63 22 9.24l-5.46 4.73L18.18 21 12 17.27z" />
          </svg>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '80px',
            left: '40px',
            opacity: 0.5,
            transform: 'rotate(12deg)',
            color: '#fbbf24',
          }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.46 14.14 2 9.24l7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        </div>

        {/* Header */}
        <div data-pdf-header style={{ position: 'relative', marginBottom: '40px' }}>
          <div
            style={{
              padding: '16px 48px',
              borderRadius: '9999px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              margin: '0 auto',
              width: 'fit-content',
              position: 'relative',
              zIndex: 10,
              backgroundColor: '#4f46e5',
              color: '#ffffff',
            }}
          >
            <div style={{ backgroundColor: '#ffffff', padding: '8px', borderRadius: '8px' }}>
              <ClipboardCheck style={{ width: '24px', height: '24px', color: '#4f46e5' }} />
            </div>
            <h1
              style={{
                fontSize: '30px',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              {t.dailyReportPDF.attendanceReport}
            </h1>
          </div>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: '4px',
              transform: 'translateY(-50%)',
              backgroundColor: '#e0e7ff',
            }}
          />
        </div>

        {/* Info Section */}
        <div
          data-pdf-item
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            marginBottom: '40px',
            padding: '24px',
            borderRadius: '24px',
            backgroundColor: '#ffffff',
            border: '2px solid #000000',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#000000',
                color: '#ffffff',
              }}
            >
              <Calendar style={{ width: '20px', height: '20px' }} />
            </div>
            <p style={{ fontSize: '20px', fontWeight: 'bold', color: '#000000' }}>
              {t.dailyReportPDF.date}{' '}
              <span style={{ marginLeft: '8px', color: '#000000' }}>
                {formatVN(dailyReportFormData.date, 'dd/MM/yyyy')}
              </span>
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#000000',
                color: '#ffffff',
              }}
            >
              <Clock style={{ width: '20px', height: '20px' }} />
            </div>
            <p style={{ fontSize: '20px', fontWeight: 'bold', color: '#000000' }}>
              {t.dailyReportPDF.time}{' '}
              <span style={{ marginLeft: '8px', color: '#000000' }}>
                {classData.startTime || '--:--'}
              </span>
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#000000',
                color: '#ffffff',
              }}
            >
              <BookOpen style={{ width: '20px', height: '20px' }} />
            </div>
            <p style={{ fontSize: '20px', fontWeight: 'bold', color: '#000000' }}>
              {t.dailyReportPDF.className}{' '}
              <span style={{ marginLeft: '8px', color: '#000000' }}>{classData.name}</span>
            </p>
          </div>
        </div>

        {/* Attendance Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* Present */}
          <div data-pdf-item style={{ position: 'relative' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '9999px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                }}
              >
                <CheckCircle2 style={{ width: '20px', height: '20px' }} />
              </div>
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 900,
                  paddingBottom: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '-0.025em',
                  color: '#000000',
                  borderBottom: '4px solid #000000',
                }}
              >
                {t.dailyReportPDF.presentStudents}
              </h2>
            </div>
            <ul
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                columnGap: '32px',
                rowGap: '8px',
                paddingLeft: '48px',
              }}
            >
              {students
                .filter(
                  (s) =>
                    s.enrollmentStatus !== 'dropped' &&
                    s.enrollmentStatus !== 'promoted' &&
                    attendanceData.find(
                      (a) =>
                        a.studentId === s.id &&
                        a.date === dailyReportFormData.date &&
                        a.status === 'present'
                    )
                )
                .map((s) => (
                  <li
                    key={s.id}
                    style={{
                      fontSize: '18px',
                      fontWeight: 'bold',
                      display: 'flex',
                      alignItems: 'center',
                      color: '#000000',
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '9999px',
                        marginRight: '12px',
                        backgroundColor: '#000000',
                      }}
                    />
                    {s.name}
                  </li>
                ))}
              {students.filter(
                (s) =>
                  s.enrollmentStatus !== 'dropped' &&
                  s.enrollmentStatus !== 'promoted' &&
                  attendanceData.find(
                    (a) =>
                      a.studentId === s.id &&
                      a.date === dailyReportFormData.date &&
                      a.status === 'present'
                  )
              ).length === 0 && (
                <li style={{ fontStyle: 'italic', color: '#000000' }}>{t.dailyReportPDF.noData}</li>
              )}
            </ul>
          </div>

          {/* Late */}
          <div data-pdf-item style={{ position: 'relative' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '9999px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                }}
              >
                <Clock style={{ width: '20px', height: '20px' }} />
              </div>
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 900,
                  paddingBottom: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '-0.025em',
                  color: '#000000',
                  borderBottom: '4px solid #000000',
                }}
              >
                {t.dailyReportPDF.lateStudents}
              </h2>
            </div>
            <ul
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '48px' }}
            >
              {students
                .filter(
                  (s) =>
                    s.enrollmentStatus !== 'dropped' &&
                    s.enrollmentStatus !== 'promoted' &&
                    attendanceData.find(
                      (a) =>
                        a.studentId === s.id &&
                        a.date === dailyReportFormData.date &&
                        a.status === 'late'
                    )
                )
                .map((s) => {
                  const att = attendanceData.find(
                    (a) =>
                      a.studentId === s.id &&
                      a.date === dailyReportFormData.date &&
                      a.status === 'late'
                  );
                  return (
                    <li
                      key={s.id}
                      style={{
                        fontSize: '18px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        color: '#000000',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '9999px',
                          marginRight: '12px',
                          backgroundColor: '#000000',
                        }}
                      />
                      {s.name}{' '}
                      {att?.minutesLate
                        ? t.dailyReportPDF.lateMinutes.replace('{minutes}', String(att.minutesLate))
                        : ''}
                    </li>
                  );
                })}
              {students.filter(
                (s) =>
                  s.enrollmentStatus !== 'dropped' &&
                  s.enrollmentStatus !== 'promoted' &&
                  attendanceData.find(
                    (a) =>
                      a.studentId === s.id &&
                      a.date === dailyReportFormData.date &&
                      a.status === 'late'
                  )
              ).length === 0 && (
                <li style={{ fontStyle: 'italic', color: '#000000' }}>
                  {t.dailyReportPDF.noLateStudents}
                </li>
              )}
            </ul>
          </div>

          {/* Absent */}
          <div data-pdf-item style={{ position: 'relative' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '9999px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                }}
              >
                <X style={{ width: '20px', height: '20px' }} />
              </div>
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 900,
                  paddingBottom: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '-0.025em',
                  color: '#000000',
                  borderBottom: '4px solid #000000',
                }}
              >
                {t.dailyReportPDF.absentStudents}
              </h2>
            </div>
            <ul
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '48px' }}
            >
              {students
                .filter(
                  (s) =>
                    s.enrollmentStatus !== 'dropped' &&
                    s.enrollmentStatus !== 'promoted' &&
                    attendanceData.find(
                      (a) =>
                        a.studentId === s.id &&
                        a.date === dailyReportFormData.date &&
                        a.status === 'absent'
                    )
                )
                .map((s) => {
                  const att = attendanceData.find(
                    (a) =>
                      a.studentId === s.id &&
                      a.date === dailyReportFormData.date &&
                      a.status === 'absent'
                  );
                  return (
                    <li
                      key={s.id}
                      style={{
                        fontSize: '18px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        color: '#000000',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '9999px',
                          marginRight: '12px',
                          backgroundColor: '#000000',
                        }}
                      />
                      {s.name}{' '}
                      <span style={{ marginLeft: '8px', fontSize: '14px', color: '#000000' }}>
                        (
                        {att?.permission
                          ? t.dailyReportPDF.withPermission
                          : t.dailyReportPDF.withoutPermission}
                        )
                      </span>
                    </li>
                  );
                })}
              {students.filter(
                (s) =>
                  s.enrollmentStatus !== 'dropped' &&
                  s.enrollmentStatus !== 'promoted' &&
                  attendanceData.find(
                    (a) =>
                      a.studentId === s.id &&
                      a.date === dailyReportFormData.date &&
                      a.status === 'absent'
                  )
              ).length === 0 && (
                <li style={{ fontStyle: 'italic', color: '#000000' }}>
                  {t.dailyReportPDF.noAbsentStudents}
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* Comments Section */}
        <div style={{ marginTop: '48px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <div
            data-pdf-item
            style={{
              padding: '24px',
              borderRadius: '24px',
              position: 'relative',
              backgroundColor: '#ffffff',
              border: '2px solid #000000',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                }}
              >
                <Edit2 style={{ width: '16px', height: '16px' }} />
              </div>
              <h3
                style={{
                  fontSize: '20px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  textDecoration: 'underline',
                  textUnderlineOffset: '4px',
                  color: '#000000',
                  textDecorationColor: '#000000',
                  textDecorationThickness: '4px',
                }}
              >
                {t.dailyReportPDF.generalComment}
              </h3>
            </div>
            <div
              style={{ paddingLeft: '44px', display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              {dailyReportFormData.generalComment.split('\n').map((line, i) => (
                <p
                  key={i}
                  style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    lineHeight: 1.6,
                    display: 'flex',
                    alignItems: 'start',
                    color: '#000000',
                  }}
                >
                  <span
                    style={{
                      marginRight: '8px',
                      marginTop: '8px',
                      width: '16px',
                      height: '2px',
                      borderRadius: '9999px',
                      flexShrink: 0,
                      backgroundColor: '#000000',
                    }}
                  />
                  {line}
                </p>
              ))}
            </div>
          </div>

          {dailyReportFormData.additionalNotes && (
            <div
              data-pdf-item
              style={{
                padding: '24px',
                borderRadius: '24px',
                position: 'relative',
                backgroundColor: '#ffffff',
                border: '2px solid #000000',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#000000',
                    color: '#ffffff',
                  }}
                >
                  <Info style={{ width: '16px', height: '16px' }} />
                </div>
                <h3
                  style={{
                    fontSize: '20px',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    textDecoration: 'underline',
                    textUnderlineOffset: '4px',
                    color: '#000000',
                    textDecorationColor: '#000000',
                    textDecorationThickness: '4px',
                  }}
                >
                  {t.dailyReportPDF.additionalNotes}
                </h3>
              </div>
              <div
                style={{
                  paddingLeft: '44px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {dailyReportFormData.additionalNotes.split('\n').map((line, i) => (
                  <p
                    key={i}
                    style={{
                      fontSize: '18px',
                      fontWeight: 'bold',
                      lineHeight: 1.6,
                      display: 'flex',
                      alignItems: 'start',
                      color: '#000000',
                    }}
                  >
                    <span
                      style={{
                        marginRight: '8px',
                        marginTop: '8px',
                        width: '16px',
                        height: '2px',
                        borderRadius: '9999px',
                        flexShrink: 0,
                        backgroundColor: '#000000',
                      }}
                    />
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Illustrations (Simulated with Lucide icons) */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            right: '40px',
            display: 'flex',
            alignItems: 'end',
            gap: '16px',
            opacity: 0.2,
          }}
        >
          <div
            style={{
              width: '80px',
              height: '96px',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#10b981',
            }}
          >
            <Users style={{ width: '40px', height: '40px', color: '#ffffff' }} />
          </div>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '9999px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#ef4444',
            }}
          >
            <Clock style={{ width: '32px', height: '32px', color: '#ffffff' }} />
          </div>
        </div>
      </div>
    </div>
  );
};
