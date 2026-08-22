import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Download,
  Eye,
  FileText,
  FolderOpen,
  GraduationCap,
  Grid3X3,
  List,
  Loader2,
  MoreVertical,
  Play,
  Plus,
  Presentation,
  Search,
  SlidersHorizontal,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import type { KnowledgeBankItem, LessonDeck } from '../../types';
import { useLanguage } from '../../lib/i18n/useLanguage';
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
  getLessonDecksForUnit,
  isGlobalSuccessGrade,
  globalSuccessLessonDecks,
} from '../../data/global-success';
import { formatFileSize } from '../../lib/files/formatFileSize';
import { getKnowledgeDocumentViewerUrl } from '../../lib/knowledgeBank/viewerUrl';

type ActiveTab = 'all' | 'documents' | 'lessons';
type KindFilter = 'all' | 'pdf' | 'docx' | 'lesson';
type SortMode = 'newest' | 'oldest' | 'name';
type ViewMode = 'grid' | 'list';

type ContentItem =
  | {
      type: 'document';
      id: string;
      title: string;
      createdAt: string;
      document: KnowledgeBankItem;
    }
  | {
      type: 'lesson';
      id: string;
      title: string;
      createdAt: string;
      lesson: LessonDeck;
    };

const parseGradeSlug = (gradeSlug?: string) => {
  const grade = Number((gradeSlug || '').replace('grade-', ''));
  return isGlobalSuccessGrade(grade) ? grade : null;
};

const parseUnitQuery = (value: string | null) => {
  const unit = Number(value || '');
  return Number.isInteger(unit) && unit >= 1 && unit <= 12 ? unit : 1;
};

const getDateTime = (value: unknown) => {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const formatDate = (value: string, language: string) => {
  const time = getDateTime(value);
  if (!time) return '';
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(time));
};

const getFileTheme = (fileType?: string) => {
  if (fileType === 'pdf') {
    return {
      label: 'PDF',
      iconClassName: 'text-red-500',
      bgClassName: 'bg-red-50',
      badgeClassName: 'bg-red-100 text-red-600',
    };
  }

  return {
    label: 'DOCX',
    iconClassName: 'text-blue-600',
    bgClassName: 'bg-blue-50',
    badgeClassName: 'bg-blue-100 text-blue-600',
  };
};

const getDownloadCount = (item: KnowledgeBankItem) => item.downloadCount ?? 0;

const contentMatchesSearch = (item: ContentItem, search: string) => {
  if (!search) return true;
  if (item.type === 'document') {
    const document = item.document;
    return [
      document.title,
      document.description,
      document.originalFilename,
      document.fileType,
      document.uploadedByName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search);
  }

  const lesson = item.lesson;
  return [
    lesson.title,
    lesson.description,
    `unit ${lesson.unitNumber}`,
    `${lesson.slides.length} slides`,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(search);
};

const defaultUploadForm = (unitNumber: number) => ({
  unitNumber: String(unitNumber),
  title: '',
  description: '',
  file: null as File | null,
});

export default function KnowledgeBankGrade() {
  const { gradeSlug } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const grade = parseGradeSlug(gradeSlug);
  const requestedUnit = parseUnitQuery(searchParams.get('unit'));
  const { language } = useLanguage();
  const t = translations[language].knowledgeBank;
  const tc = translations[language].common;
  const tv2 = translations[language].knowledgeBankV2;
  const { items, loading } = useKnowledgeBankItems();

  const [selectedUnit, setSelectedUnit] = useState(requestedUnit);
  const [searchTerm, setSearchTerm] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [activeTab, setActiveTab] = useState<ActiveTab>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<{
    item: KnowledgeBankItem;
    url: string;
    viewerUrl: string;
  } | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [uploadForm, setUploadForm] = useState(defaultUploadForm(requestedUnit));
  const resolvedGrade = grade ?? GLOBAL_SUCCESS_GRADES[0];
  const programName = getGlobalSuccessProgramName(resolvedGrade);

  useBodyScrollLock(isUploadModalOpen || !!previewDocument);

  useEffect(() => {
    setSelectedUnit(requestedUnit);
    setUploadForm(defaultUploadForm(requestedUnit));
  }, [grade, requestedUnit]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const gradeDocuments = useMemo(
    () =>
      items.filter(
        (item) => item.curriculumFamily === 'global-success' && Number(item.grade) === resolvedGrade
      ),
    [items, resolvedGrade]
  );

  const gradeLessons = useMemo(
    () => globalSuccessLessonDecks.filter((deck) => deck.grade === resolvedGrade),
    [resolvedGrade]
  );

  const unitSummaries = useMemo(
    () =>
      GLOBAL_SUCCESS_UNITS.map((unit) => {
        const documents = gradeDocuments.filter(
          (item) => Number(item.unitNumber) === unit.unitNumber
        );
        const lessons = getLessonDecksForUnit(resolvedGrade, unit.unitNumber);
        return {
          unitNumber: unit.unitNumber,
          title: unit.title,
          documentCount: documents.length,
          lessonCount: lessons.length,
        };
      }),
    [gradeDocuments, resolvedGrade]
  );

  const selectedDocuments = useMemo(
    () => gradeDocuments.filter((item) => Number(item.unitNumber) === selectedUnit),
    [gradeDocuments, selectedUnit]
  );

  const selectedLessons = useMemo(
    () => getLessonDecksForUnit(resolvedGrade, selectedUnit),
    [resolvedGrade, selectedUnit]
  );

  const contentItems = useMemo<ContentItem[]>(() => {
    const documents: ContentItem[] = selectedDocuments.map((document) => ({
      type: 'document',
      id: document.id,
      title: document.title,
      createdAt: document.createdAt,
      document,
    }));
    const lessons: ContentItem[] = selectedLessons.map((lesson) => ({
      type: 'lesson',
      id: lesson.id,
      title: lesson.title,
      createdAt: lesson.createdAt,
      lesson,
    }));

    return [...documents, ...lessons];
  }, [selectedDocuments, selectedLessons]);

  const filteredContentItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const filtered = contentItems.filter((item) => {
      if (activeTab === 'documents' && item.type !== 'document') return false;
      if (activeTab === 'lessons' && item.type !== 'lesson') return false;
      if (kindFilter === 'lesson' && item.type !== 'lesson') return false;
      if ((kindFilter === 'pdf' || kindFilter === 'docx') && item.type !== 'document') return false;
      if (
        item.type === 'document' &&
        (kindFilter === 'pdf' || kindFilter === 'docx') &&
        item.document.fileType !== kindFilter
      ) {
        return false;
      }
      return contentMatchesSearch(item, search);
    });

    filtered.sort((a, b) => {
      if (sortMode === 'name') return a.title.localeCompare(b.title, language);
      const aTime = getDateTime(a.createdAt);
      const bTime = getDateTime(b.createdAt);
      return sortMode === 'oldest' ? aTime - bTime : bTime - aTime;
    });

    return filtered;
  }, [activeTab, contentItems, kindFilter, language, searchTerm, sortMode]);

  const totalDownloads = useMemo(
    () => gradeDocuments.reduce((sum, item) => sum + getDownloadCount(item), 0),
    [gradeDocuments]
  );

  if (!grade) {
    return <Navigate to="/knowledge-bank" replace />;
  }

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  };

  const handleSelectUnit = (unitNumber: number) => {
    setSelectedUnit(unitNumber);
    setActiveTab('all');
    setUploadForm((prev) => ({ ...prev, unitNumber: String(unitNumber) }));
    setSearchParams({ unit: String(unitNumber) }, { replace: true });
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

  const handleUpload = async () => {
    const file = uploadForm.file;
    const title = uploadForm.title.trim();

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
      formData.append('targetType', 'grade');
      formData.append('grade', String(grade));
      formData.append('programName', programName);
      formData.append('curriculumFamily', 'global-success');
      formData.append('unitNumber', uploadForm.unitNumber);

      const res = await fetch('/api/v1/knowledge-bank/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');

      const uploadedUnit = Number(uploadForm.unitNumber);
      setSelectedUnit(uploadedUnit);
      setSearchParams({ unit: String(uploadedUnit) }, { replace: true });
      setIsUploadModalOpen(false);
      setUploadForm(defaultUploadForm(uploadedUnit));
      setMessage({ text: t.uploadSuccess, type: 'success' });
    } catch (err) {
      console.error('Upload error:', err);
      setMessage({ text: t.uploadError, type: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-black text-slate-950 md:text-3xl">{tv2.knowledgeBankTitle}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
          <Link to="/knowledge-bank" className="hover:text-blue-600">
            {t.home}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <Link to="/knowledge-bank" className="hover:text-blue-600">
            {tv2.knowledgeBankTitle}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span>Global Success</span>
          <ChevronRight className="h-4 w-4" />
          <span className="text-blue-600">Grade {grade}</span>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileText}
          label={t.totalDocuments}
          value={gradeDocuments.length}
          helper={t.files}
          iconClassName="bg-blue-50 text-blue-600"
        />
        <StatCard
          icon={GraduationCap}
          label={t.totalLessons}
          value={gradeLessons.length}
          helper={t.lessonDecks}
          iconClassName="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          icon={FolderOpen}
          label={tv2.totalUnits}
          value={GLOBAL_SUCCESS_UNITS.length}
          helper="Unit"
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
        <div className="grid gap-4 xl:grid-cols-[minmax(260px,1.5fr)_repeat(3,minmax(150px,0.9fr))_auto_auto] xl:items-end">
          <label className="space-y-2">
            <span className="sr-only">{tv2.searchLabel}</span>
            <div className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-500 shadow-sm focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
              <input
                type="text"
                placeholder={tv2.searchDocsLessons}
                className="min-w-0 flex-1 bg-transparent font-medium outline-none placeholder:text-slate-400"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <Search className="h-5 w-5 shrink-0 text-slate-400" />
            </div>
          </label>

          <SelectField
            label={t.grade}
            value={String(grade)}
            onChange={(value) => navigate(`/knowledge-bank/global-success/grade-${value}`)}
            options={GLOBAL_SUCCESS_GRADES.map((gradeOption) => ({
              value: String(gradeOption),
              label: `Grade ${gradeOption}`,
            }))}
          />

          <SelectField
            label="Unit"
            value={String(selectedUnit)}
            onChange={(value) => handleSelectUnit(Number(value))}
            options={GLOBAL_SUCCESS_UNITS.map((unit) => ({
              value: String(unit.unitNumber),
              label: unit.title,
            }))}
          />

          <SelectField
            label={t.typeLabel}
            value={kindFilter}
            onChange={(value) => setKindFilter(value as KindFilter)}
            options={[
              { value: 'all', label: t.allTypes },
              { value: 'pdf', label: 'PDF' },
              { value: 'docx', label: 'DOCX' },
              { value: 'lesson', label: tv2.lessonsTab },
            ]}
          />

          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setKindFilter('all');
              setActiveTab('all');
            }}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-5 text-sm font-bold text-blue-600 shadow-sm transition hover:bg-blue-100"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t.filters}
          </button>

          <button
            type="button"
            onClick={() => {
              setUploadForm(defaultUploadForm(selectedUnit));
              setIsUploadModalOpen(true);
            }}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700"
          >
            <Plus className="h-5 w-5" />
            {t.uploadDocument}
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="self-start rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_54px_rgba(15,23,42,0.07)]">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-950">{tv2.unitList}</h2>
            <ChevronDown className="h-5 w-5 text-slate-500" />
          </div>

          <div className="mt-5 max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {unitSummaries.map((unit) => {
              const active = selectedUnit === unit.unitNumber;
              return (
                <button
                  key={unit.unitNumber}
                  type="button"
                  onClick={() => handleSelectUnit(unit.unitNumber)}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-2xl p-2 text-left transition',
                    active ? 'bg-blue-50 shadow-sm' : 'hover:bg-slate-50'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition',
                      active ? 'bg-white text-blue-600 shadow-sm' : 'bg-blue-50 text-blue-600'
                    )}
                  >
                    <Presentation className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-slate-800">
                      {unit.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-medium text-slate-500">
                      {unit.documentCount} {tv2.docs} • {unit.lessonCount} {t.lessons}
                    </span>
                  </span>
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 transition',
                      active ? 'text-blue-600' : 'text-slate-400 group-hover:text-blue-600'
                    )}
                  />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled
            className="mt-5 inline-flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 text-sm font-bold text-blue-500 opacity-70"
            title={tv2.fixedUnitsHint}
          >
            <Plus className="h-4 w-4" />
            {tv2.newUnit}
          </button>
        </aside>

        <main className="min-h-[560px] rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_54px_rgba(15,23,42,0.07)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-black text-slate-950">Unit {selectedUnit}</h2>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-600">
                  {contentItems.length} {tv2.unitItems}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-100">
                <TabButton
                  active={activeTab === 'all'}
                  onClick={() => setActiveTab('all')}
                  label={`${tv2.all} (${contentItems.length})`}
                />
                <TabButton
                  active={activeTab === 'documents'}
                  onClick={() => setActiveTab('documents')}
                  icon={FileText}
                  label={`${tv2.documentsTab} (${selectedDocuments.length})`}
                />
                <TabButton
                  active={activeTab === 'lessons'}
                  onClick={() => setActiveTab('lessons')}
                  icon={Presentation}
                  label={`${tv2.lessonsTab} (${selectedLessons.length})`}
                />
              </div>
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

          <div className="mt-6 border-t border-slate-100 pt-6">
            {loading ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : filteredContentItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
                <FolderOpen className="mx-auto h-12 w-12 text-slate-300" />
                <h3 className="mt-4 text-lg font-black text-slate-950">{tv2.noItemsInUnit}</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{tv2.noItemsDesc}</p>
              </div>
            ) : (
              <div
                className={cn(
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3'
                    : 'space-y-3'
                )}
              >
                {filteredContentItems.map((item) =>
                  item.type === 'document' ? (
                    <DocumentCard
                      key={`document-${item.id}`}
                      item={item.document}
                      grade={grade}
                      unitNumber={selectedUnit}
                      language={language}
                      viewMode={viewMode}
                      isPreviewLoading={previewLoadingId === item.id}
                      isDownloadLoading={downloadingId === item.id}
                      onView={() => handleView(item.document)}
                      onDownload={() => handleDownload(item.id)}
                    />
                  ) : (
                    <LessonCard
                      key={`lesson-${item.id}`}
                      lesson={item.lesson}
                      grade={grade}
                      unitNumber={selectedUnit}
                      language={language}
                      viewMode={viewMode}
                    />
                  )
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      <AnimatePresence>
        {isUploadModalOpen && (
          <ModalPortal>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-6">
                  <div>
                    <h2 className="text-xl font-black text-slate-950">{t.uploadDocument}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {programName} / Unit {uploadForm.unitNumber}
                    </p>
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
                  <SelectField
                    label="Unit"
                    value={uploadForm.unitNumber}
                    onChange={(value) => setUploadForm({ ...uploadForm, unitNumber: value })}
                    options={GLOBAL_SUCCESS_UNITS.map((unit) => ({
                      value: String(unit.unitNumber),
                      label: unit.title,
                    }))}
                  />

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
                      id="knowledge-grade-upload"
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
                      htmlFor="knowledge-grade-upload"
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

function TabButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon?: typeof FileText;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center gap-2 border-b-2 px-4 text-sm font-bold transition',
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-slate-500 hover:text-blue-600'
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {label}
    </button>
  );
}

function DocumentCard({
  item,
  grade,
  unitNumber,
  language,
  viewMode,
  isPreviewLoading,
  isDownloadLoading,
  onView,
  onDownload,
}: {
  item: KnowledgeBankItem;
  grade: GlobalSuccessGrade;
  unitNumber: number;
  language: string;
  viewMode: ViewMode;
  isPreviewLoading: boolean;
  isDownloadLoading: boolean;
  onView: () => void;
  onDownload: () => void;
}) {
  const t = translations[language].knowledgeBank;
  const tv2 = translations[language].knowledgeBankV2;
  const theme = getFileTheme(item.fileType);
  const isList = viewMode === 'list';

  return (
    <article
      className={cn(
        'group rounded-3xl border border-slate-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_18px_50px_rgba(15,23,42,0.1)]',
        isList ? 'flex flex-col gap-4 p-4 sm:flex-row sm:items-center' : 'p-5'
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-2xl',
          theme.bgClassName,
          isList ? 'h-14 w-14' : 'h-16 w-16'
        )}
      >
        <div className="text-center">
          <FileText className={cn('mx-auto h-7 w-7', theme.iconClassName)} />
          <span
            className={cn(
              'mt-1 block rounded-md px-1.5 py-0.5 text-[10px] font-black',
              theme.badgeClassName
            )}
          >
            {theme.label}
          </span>
        </div>
      </div>

      <div className={cn('min-w-0 flex-1', !isList && 'mt-5')}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-base font-black leading-6 text-slate-950">
            {item.title}
          </h3>
          {!isList && <MoreVertical className="h-5 w-5 shrink-0 text-slate-400" />}
        </div>
        <span className="mt-3 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600">
          {tv2.documentBadge}
        </span>
        <p className="mt-3 text-sm font-semibold text-slate-500">
          Grade {grade} • Unit {unitNumber}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {formatFileSize(item.fileSize)} • {item.fileType.toUpperCase()} •{' '}
          {formatDate(item.createdAt, language)}
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
          {getDownloadCount(item)} {tv2.downloadsLabel}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onView}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-blue-600 transition hover:bg-blue-50"
            title={tv2.viewDoc}
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
            title={tv2.downloadDoc}
          >
            {isDownloadLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function LessonCard({
  lesson,
  grade,
  unitNumber,
  language,
  viewMode,
}: {
  lesson: LessonDeck;
  grade: GlobalSuccessGrade;
  unitNumber: number;
  language: string;
  viewMode: ViewMode;
}) {
  const tv2 = translations[language].knowledgeBankV2;
  const isList = viewMode === 'list';

  return (
    <article
      className={cn(
        'group rounded-3xl border border-slate-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-emerald-100 hover:shadow-[0_18px_50px_rgba(15,23,42,0.1)]',
        isList ? 'flex flex-col gap-4 p-4 sm:flex-row sm:items-center' : 'p-5'
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600',
          isList ? 'h-14 w-14' : 'h-16 w-16'
        )}
      >
        <Presentation className="h-7 w-7" />
      </div>

      <div className={cn('min-w-0 flex-1', !isList && 'mt-5')}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-base font-black leading-6 text-slate-950">
            {lesson.title}
          </h3>
          {!isList && <MoreVertical className="h-5 w-5 shrink-0 text-slate-400" />}
        </div>
        <span className="mt-3 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600">
          {tv2.lessonBadge}
        </span>
        <p className="mt-3 text-sm font-semibold text-slate-500">
          Grade {grade} • Unit {unitNumber}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {lesson.slides.length} slides • {formatDate(lesson.createdAt, language)}
        </p>
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-3',
          isList ? 'w-full sm:w-auto sm:shrink-0' : 'mt-5 border-t border-slate-100 pt-4'
        )}
      >
        <span className="text-sm font-semibold text-slate-500">
          {lesson.slides.length} {tv2.slidesLabel}
        </span>
        <Link
          to={`/lesson-player/${lesson.id}`}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-bold text-white transition hover:bg-blue-700"
        >
          <Play className="h-4 w-4" />
          {tv2.openLessonBtn}
        </Link>
      </div>
    </article>
  );
}
