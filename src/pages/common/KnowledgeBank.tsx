import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  GraduationCap,
  Grid3X3,
  List,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import type { KnowledgeBankItem, UserProfile } from '../../types';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { localize } from '../../lib/i18n/localize';
import { translations } from '../../lib/i18n/translations';
import { cn } from '../../lib/core/utils';
import { useKnowledgeBankItems } from '../../hooks/useKnowledgeBankItems';
import { ModalPortal } from '../../components/common/ModalPortal';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import {
  GLOBAL_SUCCESS_GRADES,
  GLOBAL_SUCCESS_UNITS,
  GlobalSuccessGrade,
  getGlobalSuccessProgramName,
  globalSuccessLessonDecks,
} from '../../data/global-success';
import { formatFileSize } from '../../lib/files/formatFileSize';
import { getKnowledgeDocumentViewerUrl } from '../../lib/knowledgeBank/viewerUrl';
import { useMotionSafe } from '../../hooks/useMotionSafe';
import { Magnetic } from '../../components/common/Magnetic';

interface KnowledgeBankProps {
  profile: UserProfile | null;
}

type ViewMode = 'grid' | 'list';
type SortMode = 'newest' | 'oldest' | 'name';
type UploadTargetType = 'global-success' | 'grade' | 'program';
type FileTypeFilter = 'all' | 'pdf' | 'docx';
type DownloadAwareItem = KnowledgeBankItem & {
  downloadCount?: number;
  downloads?: number;
  downloadTotal?: number;
};

const GRADE_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);

const getFileTheme = (fileType?: string) => {
  if (fileType === 'pdf') {
    return {
      label: 'PDF',
      icon: 'text-red-500',
      bg: 'bg-red-50',
      badge: 'bg-red-100 text-red-600',
      border: 'group-hover:border-red-100',
    };
  }

  return {
    label: 'DOCX',
    icon: 'text-blue-600',
    bg: 'bg-blue-50',
    badge: 'bg-blue-100 text-blue-600',
    border: 'group-hover:border-blue-100',
  };
};

const getDateFromValue = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'object') {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate();
    if (typeof maybeTimestamp.seconds === 'number') return new Date(maybeTimestamp.seconds * 1000);
  }
  return null;
};

const getDateTime = (value: unknown) => getDateFromValue(value)?.getTime() ?? 0;

const formatDocumentDate = (value: unknown, language: string) => {
  const date = getDateFromValue(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const getDownloadCount = (item: KnowledgeBankItem) => {
  const withMetrics = item as DownloadAwareItem;
  return withMetrics.downloadCount ?? withMetrics.downloads ?? withMetrics.downloadTotal ?? 0;
};

const getDocumentTargetLabel = (item: KnowledgeBankItem, language: string) => {
  if (item.curriculumFamily === 'global-success' && item.grade && item.unitNumber) {
    return `Grade ${item.grade} • Unit ${item.unitNumber}`;
  }
  const t = translations[language].knowledgeBank;
  if (item.targetType === 'grade' && item.grade) {
    return t.gradePrefix.replace('{grade}', String(item.grade));
  }
  if (item.targetType === 'program' && item.programName) return item.programName;
  if (item.className) return item.className;
  return t.unclassified;
};

const getSearchHaystack = (item: KnowledgeBankItem) =>
  [
    item.title,
    item.description,
    item.originalFilename,
    item.uploadedByName,
    item.programName,
    item.className,
    item.grade ? `grade ${item.grade} khối ${item.grade}` : '',
    item.unitNumber ? `unit ${item.unitNumber}` : '',
    item.fileType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const defaultUploadForm = (gradeFilter: string, unitFilter: string) => ({
  targetType: 'global-success' as UploadTargetType,
  title: '',
  description: '',
  grade: GLOBAL_SUCCESS_GRADES.includes(Number(gradeFilter) as GlobalSuccessGrade)
    ? gradeFilter
    : '6',
  unitNumber: unitFilter !== 'all' ? unitFilter : '1',
  targetGrade: '',
  programName: '',
  file: null as File | null,
});

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 350, damping: 25 } },
};

export default function KnowledgeBank({ profile }: KnowledgeBankProps) {
  const { language } = useLanguage();
  const { shouldReduceMotion } = useMotionSafe();
  const t = translations[language].knowledgeBank;
  const tc = translations[language].common;
  const { items, loading } = useKnowledgeBankItems();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [selectedUnit, setSelectedUnit] = useState('all');
  const [selectedFileType, setSelectedFileType] = useState<FileTypeFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<{
    item: KnowledgeBankItem;
    url: string;
    viewerUrl: string;
  } | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [uploadForm, setUploadForm] = useState(defaultUploadForm('all', 'all'));

  useBodyScrollLock(isUploadModalOpen || !!deletingId || !!previewDocument);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const gradeSummaries = useMemo(
    () =>
      GLOBAL_SUCCESS_GRADES.map((grade) => {
        const documentCount = items.filter(
          (item) => item.curriculumFamily === 'global-success' && Number(item.grade) === grade
        ).length;
        const lessonCount = globalSuccessLessonDecks.filter((deck) => deck.grade === grade).length;

        return {
          grade,
          title: getGlobalSuccessProgramName(grade),
          documentCount,
          lessonCount,
        };
      }),
    [items]
  );

  const filteredItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const sorted = items.filter((item) => {
      if (selectedGrade !== 'all' && Number(item.grade) !== Number(selectedGrade)) return false;
      if (selectedUnit !== 'all' && Number(item.unitNumber) !== Number(selectedUnit)) return false;
      if (selectedFileType !== 'all' && item.fileType !== selectedFileType) return false;
      if (search && !getSearchHaystack(item).includes(search)) return false;
      return true;
    });

    sorted.sort((a, b) => {
      if (sortMode === 'name') return a.title.localeCompare(b.title, language);
      const aTime = getDateTime(a.createdAt);
      const bTime = getDateTime(b.createdAt);
      return sortMode === 'oldest' ? aTime - bTime : bTime - aTime;
    });

    return sorted;
  }, [items, language, searchTerm, selectedFileType, selectedGrade, selectedUnit, sortMode]);

  const totalDownloads = useMemo(
    () => items.reduce((sum, item) => sum + getDownloadCount(item), 0),
    [items]
  );

  const hasActiveFilters =
    searchTerm.trim() ||
    selectedGrade !== 'all' ||
    selectedUnit !== 'all' ||
    selectedFileType !== 'all';

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedGrade('all');
    setSelectedUnit('all');
    setSelectedFileType('all');
  };

  const resetUploadForm = () => {
    setUploadForm(defaultUploadForm(selectedGrade, selectedUnit));
  };

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  };

  const canDelete = (item: KnowledgeBankItem) =>
    !!profile && (item.uploadedBy === profile.uid || profile.role === 'admin');

  const openUploadModal = () => {
    resetUploadForm();
    setIsUploadModalOpen(true);
  };

  const handleUpload = async () => {
    const file = uploadForm.file;
    const title = uploadForm.title.trim();
    const programName = uploadForm.programName.trim();

    if (!file) {
      setMessage({ text: t.noFileSelected, type: 'error' });
      return;
    }
    if (!title) {
      setMessage({
        text: t.enterTitle,
        type: 'error',
      });
      return;
    }
    if (
      uploadForm.targetType === 'global-success' &&
      (!uploadForm.grade || !uploadForm.unitNumber)
    ) {
      setMessage({ text: t.noTargetSelected, type: 'error' });
      return;
    }
    if (uploadForm.targetType === 'grade' && !uploadForm.targetGrade) {
      setMessage({ text: t.noTargetSelected, type: 'error' });
      return;
    }
    if (uploadForm.targetType === 'program' && !programName) {
      setMessage({ text: t.noTargetSelected, type: 'error' });
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'docx') {
      setMessage({ text: t.invalidFileType, type: 'error' });
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setMessage({
        text: t.fileTooLarge,
        type: 'error',
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title);
      formData.append('description', uploadForm.description.trim());
      formData.append('resourceKind', 'document');

      if (uploadForm.targetType === 'global-success') {
        const grade = Number(uploadForm.grade) as GlobalSuccessGrade;
        formData.append('targetType', 'grade');
        formData.append('grade', String(grade));
        formData.append('programName', getGlobalSuccessProgramName(grade));
        formData.append('curriculumFamily', 'global-success');
        formData.append('unitNumber', uploadForm.unitNumber);
      } else if (uploadForm.targetType === 'grade') {
        formData.append('targetType', 'grade');
        formData.append('grade', uploadForm.targetGrade);
      } else {
        formData.append('targetType', 'program');
        formData.append('programName', programName);
      }

      const res = await fetch('/api/v1/knowledge-bank/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');

      setIsUploadModalOpen(false);
      resetUploadForm();
      setMessage({ text: t.uploadSuccess, type: 'success' });
    } catch (err) {
      console.error('Upload error:', err);
      setMessage({ text: t.uploadError, type: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleView = async (item: KnowledgeBankItem) => {
    setPreviewLoadingId(item.id);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/knowledge-bank/download?id=${item.id}&mode=inline`, {
        headers,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      if (typeof data.url !== 'string' || !data.url.trim()) throw new Error('Missing preview URL');
      const viewerUrl = getKnowledgeDocumentViewerUrl(item.fileType, data.url);
      setPreviewDocument({ item, url: data.url, viewerUrl });
    } catch (err) {
      console.error('View error:', err);
      setMessage({
        text: t.viewError,
        type: 'error',
      });
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const handleDownload = async (id: string) => {
    if (downloadingId) return;
    setDownloadingId(id);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/knowledge-bank/download?id=${id}&mode=attachment`, {
        headers,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      if (typeof data.url !== 'string' || !data.url.trim()) throw new Error('Missing download URL');

      const link = document.createElement('a');
      link.href = data.url;
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Download error:', err);
      setMessage({
        text: t.downloadError,
        type: 'error',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setIsDeleting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/knowledge-bank/${id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      setDeletingId(null);
      setMessage({ text: t.deleteSuccess, type: 'success' });
    } catch (err) {
      console.error('Delete error:', err);
      setMessage({ text: t.deleteError, type: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
          <span>{t.home}</span>
          <ChevronRight className="h-4 w-4" />
          <span className="text-blue-600">{t.title}</span>
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-950 md:text-3xl">{t.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{t.landingDesc}</p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileText}
          label={t.totalDocuments}
          value={items.length}
          helper={t.files}
          iconClassName="bg-blue-50 text-blue-600"
        />
        <StatCard
          icon={GraduationCap}
          label={t.totalLessons}
          value={globalSuccessLessonDecks.length}
          helper={t.lessonDecks}
          iconClassName="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          icon={FolderOpen}
          label={t.totalGrades}
          value={GLOBAL_SUCCESS_GRADES.length}
          helper={t.gradeShort}
          iconClassName="bg-purple-50 text-purple-600"
        />
        <StatCard
          icon={UsersRound}
          label={t.totalDownloads}
          value={totalDownloads.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US')}
          helper={t.downloads}
          iconClassName="bg-orange-50 text-orange-600"
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_54px_rgba(15,23,42,0.07)]">
        <div className="grid gap-4 xl:grid-cols-[minmax(260px,1.45fr)_repeat(3,minmax(160px,0.95fr))_auto_auto] xl:items-end">
          <label className="space-y-2">
            <span className="sr-only">{t.searchPlaceholder}</span>
            <div className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-500 shadow-sm focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
              <input
                type="text"
                placeholder={t.searchDocuments}
                className="min-w-0 flex-1 bg-transparent font-medium outline-none placeholder:text-slate-400"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <Search className="h-5 w-5 shrink-0 text-slate-400" />
            </div>
          </label>

          <SelectField
            label={t.gradeLabel}
            value={selectedGrade}
            onChange={setSelectedGrade}
            options={[
              { value: 'all', label: t.allGrades },
              ...GLOBAL_SUCCESS_GRADES.map((grade) => ({
                value: String(grade),
                label: `Grade ${grade}`,
              })),
            ]}
          />

          <SelectField
            label="Unit"
            value={selectedUnit}
            onChange={setSelectedUnit}
            options={[
              { value: 'all', label: t.allUnits },
              ...GLOBAL_SUCCESS_UNITS.map((unit) => ({
                value: String(unit.unitNumber),
                label: unit.title,
              })),
            ]}
          />

          <SelectField
            label={t.typeLabel}
            value={selectedFileType}
            onChange={(value) => setSelectedFileType(value as FileTypeFilter)}
            options={[
              { value: 'all', label: t.allTypes },
              { value: 'pdf', label: 'PDF' },
              { value: 'docx', label: 'DOCX' },
            ]}
          />

          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className={cn(
              'inline-flex h-12 items-center justify-center gap-2 rounded-2xl border px-5 text-sm font-bold shadow-sm transition',
              hasActiveFilters
                ? 'border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100'
                : 'cursor-default border-slate-200 bg-slate-50 text-slate-400'
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t.filters}
          </button>

          <button
            type="button"
            onClick={openUploadModal}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700"
          >
            <Plus className="h-5 w-5" />
            {t.uploadDocument}
          </button>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="self-start rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_54px_rgba(15,23,42,0.07)]">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-950">{t.categories}</h2>
            <ChevronDown className="h-5 w-5 text-slate-500" />
          </div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="mt-5 space-y-3"
          >
            {gradeSummaries.map((summary) => (
              <motion.div
                key={summary.grade}
                variants={itemVariants}
                whileHover={{
                  x: 6,
                  scale: 1.015,
                  transition: { type: 'spring', stiffness: 450, damping: 24 },
                }}
                className="w-full"
              >
                <Link
                  to={`/knowledge-bank/global-success/grade-${summary.grade}`}
                  className="group flex items-center gap-3 rounded-2xl border border-transparent dark:border-slate-800 p-2 transition-colors hover:border-blue-100 dark:hover:border-blue-800 hover:bg-blue-50/70 dark:hover:bg-blue-550/10 w-full"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                    <Folder className="h-6 w-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-slate-700 dark:text-slate-200">
                      {summary.title}
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold text-slate-500">
                      {summary.documentCount} {t.documents} • {summary.lessonCount} {t.lessons}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" />
                </Link>
              </motion.div>
            ))}
          </motion.div>

          <button
            type="button"
            disabled
            className="mt-5 inline-flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 text-sm font-bold text-blue-500 opacity-70"
            title={t.customFolderDisabled}
          >
            <Plus className="h-4 w-4" />
            {t.newFolder}
          </button>
        </aside>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_54px_rgba(15,23,42,0.07)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">{t.documentList}</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {filteredItems.length} {t.documents}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SelectField
                label={t.sort}
                srOnlyLabel
                value={sortMode}
                onChange={(value) => setSortMode(value as SortMode)}
                options={[
                  {
                    value: 'newest',
                    label: t.sortNewest,
                  },
                  {
                    value: 'oldest',
                    label: t.sortOldest,
                  },
                  {
                    value: 'name',
                    label: t.sortName,
                  },
                ]}
                className="sm:w-52"
              />
              <div className="inline-flex h-12 rounded-2xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl transition',
                    viewMode === 'list'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-400 hover:text-blue-600'
                  )}
                  title={t.listView}
                >
                  <List className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl transition',
                    viewMode === 'grid'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-400 hover:text-blue-600'
                  )}
                  title={t.gridView}
                >
                  <Grid3X3 className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5">
            {loading ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
                <FileText className="mx-auto h-12 w-12 text-slate-300" />
                <h3 className="mt-4 text-lg font-black text-slate-950">{t.emptyTitle}</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{t.emptyDesc}</p>
                <button
                  type="button"
                  onClick={openUploadModal}
                  className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700"
                >
                  <Upload className="h-4 w-4" />
                  {t.uploadDocument}
                </button>
              </div>
            ) : (
              <div
                className={cn(
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3'
                    : 'space-y-3'
                )}
              >
                <AnimatePresence>
                  {filteredItems.map((item) => (
                    <DocumentCard
                      key={item.id}
                      item={item}
                      language={language}
                      viewMode={viewMode}
                      canDelete={canDelete(item)}
                      isPreviewLoading={previewLoadingId === item.id}
                      isDownloadLoading={downloadingId === item.id}
                      onView={() => handleView(item)}
                      onDownload={() => handleDownload(item.id)}
                      onDelete={() => setDeletingId(item.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {isUploadModalOpen && (
          <ModalPortal>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-6">
                  <div>
                    <h2 className="text-xl font-black text-slate-950">{t.uploadDocument}</h2>
                    <p className="mt-1 text-sm text-slate-500">{t.uploadDesc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsUploadModalOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      {t.saveLocation}
                    </label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        {
                          value: 'global-success',
                          label: 'Global Success',
                        },
                        {
                          value: 'grade',
                          label: t.byGrade,
                        },
                        {
                          value: 'program',
                          label: t.program,
                        },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            setUploadForm({
                              ...uploadForm,
                              targetType: option.value as UploadTargetType,
                            })
                          }
                          className={cn(
                            'rounded-xl border px-3 py-2.5 text-sm font-bold transition',
                            uploadForm.targetType === option.value
                              ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-100'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {uploadForm.targetType === 'global-success' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormSelect
                        label={t.grade}
                        value={uploadForm.grade}
                        onChange={(value) => setUploadForm({ ...uploadForm, grade: value })}
                        options={GLOBAL_SUCCESS_GRADES.map((grade) => ({
                          value: String(grade),
                          label: getGlobalSuccessProgramName(grade),
                        }))}
                      />
                      <FormSelect
                        label="Unit"
                        value={uploadForm.unitNumber}
                        onChange={(value) => setUploadForm({ ...uploadForm, unitNumber: value })}
                        options={GLOBAL_SUCCESS_UNITS.map((unit) => ({
                          value: String(unit.unitNumber),
                          label: unit.title,
                        }))}
                      />
                    </div>
                  )}

                  {uploadForm.targetType === 'grade' && (
                    <FormSelect
                      label={t.grade}
                      value={uploadForm.targetGrade}
                      onChange={(value) => setUploadForm({ ...uploadForm, targetGrade: value })}
                      options={[
                        { value: '', label: t.gradePlaceholder },
                        ...GRADE_OPTIONS.map((grade) => ({
                          value: String(grade),
                          label: t.gradePrefix.replace('{grade}', String(grade)),
                        })),
                      ]}
                    />
                  )}

                  {uploadForm.targetType === 'program' && (
                    <div>
                      <label className="mb-1 block text-sm font-bold text-slate-700">
                        {t.programLabel}
                      </label>
                      <input
                        type="text"
                        className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                        value={uploadForm.programName}
                        onChange={(event) =>
                          setUploadForm({ ...uploadForm, programName: event.target.value })
                        }
                        placeholder={t.programPlaceholder}
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-700">
                      {t.titleLabel}
                    </label>
                    <input
                      type="text"
                      className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                      value={uploadForm.title}
                      onChange={(event) =>
                        setUploadForm({ ...uploadForm, title: event.target.value })
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-700">
                      {t.descriptionLabel}
                    </label>
                    <textarea
                      rows={3}
                      className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                      value={uploadForm.description}
                      onChange={(event) =>
                        setUploadForm({ ...uploadForm, description: event.target.value })
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-700">
                      {t.fileLabel}
                    </label>
                    <input
                      type="file"
                      id="knowledge-bank-upload"
                      accept=".pdf,.docx"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        setUploadForm((prev) => ({
                          ...prev,
                          file,
                          title: prev.title || (file ? file.name.replace(/\.[^/.]+$/, '') : ''),
                        }));
                      }}
                    />
                    <label
                      htmlFor="knowledge-bank-upload"
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-5 text-sm font-semibold text-slate-500 transition hover:border-blue-300 hover:bg-blue-50"
                    >
                      <CloudUpload className="h-5 w-5" />
                      {uploadForm.file ? uploadForm.file.name : t.selectFile}
                    </label>
                  </div>
                </div>

                <div className="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-slate-50 p-6">
                  <button
                    type="button"
                    onClick={() => setIsUploadModalOpen(false)}
                    className="h-11 rounded-xl px-5 text-sm font-bold text-slate-600 transition hover:bg-slate-200"
                  >
                    {tc.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={isUploading}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    {isUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {isUploading ? t.uploading : t.upload}
                  </button>
                </div>
              </motion.div>
            </div>
          </ModalPortal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewDocument && (
          <ModalPortal>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
              >
                <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-black text-slate-950">
                      {previewDocument.item.title}
                    </h2>
                    <p className="truncate text-xs text-slate-500">
                      {previewDocument.item.originalFilename}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload(previewDocument.item.id)}
                      disabled={downloadingId === previewDocument.item.id}
                      aria-busy={downloadingId === previewDocument.item.id}
                      className="hidden h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
                    >
                      {downloadingId === previewDocument.item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {downloadingId === previewDocument.item.id ? 'Downloading...' : t.download}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewDocument(null)}
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                {previewDocument.item.fileType === 'docx' && (
                  <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-5 py-2 text-xs font-medium text-blue-700">
                    {t.docxHint}
                  </div>
                )}
                <div className="min-h-0 flex-1 bg-slate-100">
                  <iframe
                    title={previewDocument.item.title}
                    src={previewDocument.viewerUrl}
                    className="h-full w-full border-0 bg-white"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </motion.div>
            </div>
          </ModalPortal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deletingId && (
          <ModalPortal>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
              />
              <motion.div
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 380, damping: 26 }
                }
                className="relative bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/50 w-full max-w-sm p-6 text-center z-10 shadow-2xl"
              >
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 mb-4">
                  <Trash2 className="h-7 w-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
                  {t.deleteConfirmTitle}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                  {t.deleteConfirmDesc}
                </p>
                <div className="flex gap-3 justify-end items-center">
                  <Magnetic>
                    <button
                      type="button"
                      onClick={() => setDeletingId(null)}
                      disabled={isDeleting}
                      className="px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors flex-1 w-full shadow-sm"
                    >
                      {tc.cancel}
                    </button>
                  </Magnetic>
                  <Magnetic>
                    <button
                      type="button"
                      onClick={() => handleDelete(deletingId)}
                      disabled={isDeleting}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-1 w-full shadow-lg"
                    >
                      {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
                      {t.deleteNow}
                    </button>
                  </Magnetic>
                </div>
              </motion.div>
            </div>
          </ModalPortal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className={cn(
              'fixed left-1/2 top-6 z-[2000] -translate-x-1/2 rounded-2xl px-6 py-3 text-sm font-bold shadow-xl',
              message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            )}
          >
            {message.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  iconClassName,
}: {
  icon: typeof FileText;
  label: string;
  value: number | string;
  helper: string;
  iconClassName: string;
}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_54px_rgba(15,23,42,0.07)]">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl',
            iconClassName
          )}
        >
          <Icon className="h-7 w-7" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-black leading-none text-slate-950">{value}</p>
          <p className="mt-2 text-xs font-medium text-slate-500">{helper}</p>
        </div>
      </div>
    </article>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  className,
  srOnlyLabel = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
  srOnlyLabel?: boolean;
}) {
  return (
    <label className={cn('space-y-2', className)}>
      <span className={cn('block text-xs font-bold text-slate-600', srOnlyLabel && 'sr-only')}>
        {label}
      </span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-slate-600 shadow-sm outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  );
}

function FormSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold text-slate-700">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  );
}

function DocumentCard({
  item,
  language,
  viewMode,
  canDelete,
  isPreviewLoading,
  isDownloadLoading,
  onView,
  onDownload,
  onDelete,
}: {
  item: KnowledgeBankItem;
  language: string;
  viewMode: ViewMode;
  canDelete: boolean;
  isPreviewLoading: boolean;
  isDownloadLoading: boolean;
  onView: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const t = translations[language].knowledgeBank;
  const theme = getFileTheme(item.fileType);
  const isList = viewMode === 'list';

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      whileHover={{
        y: -6,
        scale: 1.015,
        boxShadow: '0 20px 45px rgba(59, 130, 246, 0.08)',
        transition: { type: 'spring', stiffness: 450, damping: 24 },
      }}
      className={cn(
        'group rounded-3xl border border-slate-200 dark:border-slate-750 bg-white dark:bg-slate-800 shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition-all duration-200 cursor-default',
        theme.border,
        isList ? 'flex flex-col gap-4 p-4 sm:flex-row sm:items-center' : 'p-5'
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-2xl',
          theme.bg,
          isList ? 'h-14 w-14' : 'h-16 w-16'
        )}
      >
        <div className="text-center">
          <FileText className={cn('mx-auto h-7 w-7', theme.icon)} />
          <span
            className={cn(
              'mt-1 block rounded-md px-1.5 py-0.5 text-[10px] font-black',
              theme.badge
            )}
          >
            {theme.label}
          </span>
        </div>
      </div>

      <div className={cn('min-w-0 flex-1', !isList && 'mt-5')}>
        <h3 className="line-clamp-2 text-base font-black leading-6 text-slate-950">{item.title}</h3>
        <p className="mt-3 text-sm font-semibold text-slate-500">
          {getDocumentTargetLabel(item, language)}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {formatFileSize(item.fileSize)} • {formatDocumentDate(item.createdAt, language)}
        </p>
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-3',
          isList ? 'w-full sm:w-auto sm:shrink-0' : 'mt-5 border-t border-slate-100 pt-4'
        )}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
          <Download className="h-4 w-4" />
          {getDownloadCount(item)}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onView}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-blue-600 transition hover:bg-blue-50"
            title={t.viewDocument}
          >
            {isPreviewLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={isDownloadLoading}
            aria-busy={isDownloadLoading}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            title={t.downloadDocument}
          >
            {isDownloadLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              title={t.deleteDocument}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}
