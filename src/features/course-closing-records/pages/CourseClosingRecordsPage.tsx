import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CourseClosingDocumentPreviewModal } from '../components/CourseClosingDocumentPreviewModal.js';
import { CourseClosingRecordPreviewModal } from '../components/CourseClosingRecordPreviewModal.js';
import { CourseClosingRecordsHeader } from '../components/CourseClosingRecordsHeader.js';
import { CourseClosingRecordsTable } from '../components/CourseClosingRecordsTable.js';
import { useCourseClosingRecordsStore } from '../courseClosingRecordsStore.js';
import {
  COURSE_CLOSING_SEARCH_DEBOUNCE_MS,
  fetchCourseClosingRecordFile,
  useCourseClosingRecordMonthQuery,
  useCourseClosingRecordFileQuery,
  useCourseClosingRecordsQuery,
} from '../courseClosingRecordsQueries.js';
import { useLanguage } from '../../../lib/i18n/useLanguage.js';
import { getKnowledgeDocumentViewerUrl } from '../../../lib/knowledgeBank/viewerUrl.js';

interface CourseClosingRecordsPageProps {
  userRole: string;
}

type DocumentPreviewSelection = {
  recordId: string;
  studentName: string;
  documentType: 'evaluation' | 'tuition';
};

export function CourseClosingRecordsPage({ userRole }: CourseClosingRecordsPageProps) {
  const { t } = useLanguage();
  const copy = t.courseClosingRecordsPage;
  const {
    month,
    setMonth,
    submittedSearchQuery,
    submitSearchQuery,
    statusFilter,
    documentTypeFilter,
  } = useCourseClosingRecordsStore();
  const [previewRecord, setPreviewRecord] = useState<any>();
  const [documentPreview, setDocumentPreview] = useState<DocumentPreviewSelection>();
  const [isDownloadingDocument, setIsDownloadingDocument] = useState(false);
  const [documentDownloadError, setDocumentDownloadError] = useState<string>();
  const monthTouched = useRef(false);
  const latestMonthApplied = useRef(false);

  const monthQuery = useCourseClosingRecordMonthQuery();
  useEffect(() => {
    if (monthQuery.data?.month && !monthTouched.current && !latestMonthApplied.current) {
      latestMonthApplied.current = true;
      setMonth(monthQuery.data.month);
    }
  }, [monthQuery.data?.month, setMonth]);

  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(submittedSearchQuery);
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearchQuery(submittedSearchQuery),
      COURSE_CLOSING_SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [submittedSearchQuery]);

  const recordsQuery = useCourseClosingRecordsQuery(month, debouncedSearchQuery);
  const documentFileQuery = useCourseClosingRecordFileQuery(
    documentPreview?.recordId,
    documentPreview?.documentType
  );
  const documentViewerUrl = documentFileQuery.data?.url
    ? getKnowledgeDocumentViewerUrl('docx', documentFileQuery.data.url)
    : undefined;
  const rawRecords = recordsQuery.data?.records || [];

  const filteredRecords = useMemo(
    () =>
      rawRecords.filter((record) => {
        if (statusFilter !== 'all' && record.displayStatus !== statusFilter) return false;
        if (documentTypeFilter === 'evaluation') {
          return record.evaluationDocument?.status === 'ready';
        }
        if (documentTypeFilter === 'tuition') {
          return record.tuitionDocument?.status === 'ready';
        }
        return true;
      }),
    [documentTypeFilter, rawRecords, statusFilter]
  );

  const handleDocumentDownload = async () => {
    if (!documentPreview || isDownloadingDocument) return;

    setIsDownloadingDocument(true);
    setDocumentDownloadError(undefined);
    try {
      const file = await fetchCourseClosingRecordFile(
        documentPreview.recordId,
        documentPreview.documentType,
        'attachment'
      );
      const link = document.createElement('a');
      link.href = file.url;
      link.download = file.downloadFilename;
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setDocumentDownloadError(copy.documentDownloadError);
    } finally {
      setIsDownloadingDocument(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <CourseClosingRecordsHeader
        month={month}
        onMonthChange={(nextMonth) => {
          monthTouched.current = true;
          setMonth(nextMonth);
        }}
        onSearchSubmit={submitSearchQuery}
        records={filteredRecords}
        truncated={recordsQuery.data?.truncated || false}
        role={userRole}
      />

      <div
        role="note"
        className="mb-5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
      >
        {copy.deploymentNotice}
      </div>

      {recordsQuery.isLoading ? (
        <div role="status" className="p-12 text-center text-slate-500">
          {copy.loading}
        </div>
      ) : recordsQuery.isError ? (
        <div role="alert" className="p-12 text-center text-rose-600">
          {copy.error}
        </div>
      ) : (
        <CourseClosingRecordsTable
          records={filteredRecords}
          role={userRole}
          onDocumentPreview={(record, documentType) => {
            setDocumentDownloadError(undefined);
            setDocumentPreview({
              recordId: record.id,
              studentName: record.studentName,
              documentType,
            });
          }}
          onPreview={setPreviewRecord}
        />
      )}

      {previewRecord && (
        <CourseClosingRecordPreviewModal
          record={previewRecord}
          role={userRole}
          onClose={() => setPreviewRecord(undefined)}
        />
      )}

      {documentPreview && (
        <CourseClosingDocumentPreviewModal
          studentName={documentPreview.studentName}
          documentType={documentPreview.documentType}
          viewerUrl={documentViewerUrl}
          isLoading={documentFileQuery.isLoading || documentFileQuery.isFetching}
          error={
            documentFileQuery.error instanceof Error
              ? documentFileQuery.error.message
              : documentFileQuery.isError
                ? copy.documentPreviewError
                : undefined
          }
          isDownloading={isDownloadingDocument}
          downloadError={documentDownloadError}
          onRetry={() => void documentFileQuery.refetch()}
          onDownload={() => void handleDocumentDownload()}
          onClose={() => {
            setDocumentPreview(undefined);
            setDocumentDownloadError(undefined);
          }}
        />
      )}
    </div>
  );
}
