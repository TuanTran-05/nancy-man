import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../../api.js';
import type {
  DatabaseCell,
  DatabaseExplorerRelation,
  DatabaseExplorerSchemaSnapshot,
  DatabaseFilterOperator,
  DatabasePageSize,
  DatabaseRowsResponse,
  DatabaseTargetId,
  DatabaseTargetSummary
} from '../../../../../packages/contracts/src/databaseExplorer.js';
import {
  getDatabaseSchema,
  getDatabaseTargets,
  hideDatabasePii,
  queryDatabaseRows,
  queryRelatedRows,
  revealDatabasePii
} from './databaseApi.js';

export type DatabaseExplorerTab = 'data' | 'structure' | 'relations' | 'erd';

export type DatabaseFilter = {
  column: string;
  operator: DatabaseFilterOperator;
  value?: string;
};

export type DatabaseSort = {
  column: string;
  direction: 'asc' | 'desc';
};

export type UseDatabaseExplorerProps = {
  session: SessionInfo;
  onUnauthorized: () => void;
};

export function useDatabaseExplorer({ session, onUnauthorized }: UseDatabaseExplorerProps) {
  const [targets, setTargets] = useState<DatabaseTargetSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<DatabaseTargetId | null>(null);
  const [schema, setSchema] = useState<DatabaseExplorerSchemaSnapshot | null>(null);
  const [selectedSchemaName, setSelectedSchemaName] = useState<string | null>(null);
  const [selectedRelationName, setSelectedRelationName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DatabaseExplorerTab>('data');

  const [rows, setRows] = useState<DatabaseRowsResponse | null>(null);
  const [pageSize, setPageSize] = useState<DatabasePageSize>(25);
  const [filters, setFilters] = useState<DatabaseFilter[]>([]);
  const [sort, setSort] = useState<DatabaseSort | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);

  const [selectedCell, setSelectedCell] = useState<{
    rowRef: string | null;
    column: string;
    cell: DatabaseCell;
  } | null>(null);

  const [relatedRowsDrawer, setRelatedRowsDrawer] = useState<{
    open: boolean;
    constraint?: string;
    rowRef?: string;
    relation?: string;
    targetRelation?: string;
    loading?: boolean;
    rows?: DatabaseRowsResponse | null;
  } | null>(null);

  const [piiReveal, setPiiReveal] = useState<{
    active: boolean;
    expiresAt: string | null;
  }>({ active: false, expiresAt: null });

  const [isRevealDialogOpen, setIsRevealDialogOpen] = useState(false);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isViewer = session.role === 'ops_viewer';
  const schemaGenerationRef = useRef(0);
  const rowsGenerationRef = useRef(0);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  // Load targets on initial mount
  useEffect(() => {
    let active = true;
    setLoadingTargets(true);
    getDatabaseTargets()
      .then((res) => {
        if (!active) return;
        setTargets(res.targets);
        if (res.targets.length > 0) {
          const firstAvailable =
            res.targets.find((t) => t.status === 'available') ?? res.targets[0];
          setSelectedTargetId(firstAvailable.id);
        }
      })
      .catch((err) => {
        if (!active) return;
        if (err?.status === 401) onUnauthorizedRef.current();
        else setError(err?.message ?? 'Không thể tải danh sách database');
      })
      .finally(() => {
        if (active) setLoadingTargets(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Target change resets and loads schema
  const selectTarget = useCallback((targetId: DatabaseTargetId) => {
    schemaGenerationRef.current += 1;
    rowsGenerationRef.current += 1;
    setSelectedTargetId(targetId);
    setSchema(null);
    setSelectedSchemaName(null);
    setSelectedRelationName(null);
    setRows(null);
    setCursorStack([]);
    setCurrentCursor(undefined);
    setFilters([]);
    setSort(undefined);
    setSelectedCell(null);
    setRelatedRowsDrawer(null);
    setPiiReveal({ active: false, expiresAt: null });
    setError(null);
  }, []);

  // When selectedTargetId changes, fetch schema
  useEffect(() => {
    if (!selectedTargetId) return;
    const currentGeneration = ++schemaGenerationRef.current;
    setLoadingSchema(true);
    setError(null);

    getDatabaseSchema(selectedTargetId)
      .then((snapshot) => {
        if (schemaGenerationRef.current !== currentGeneration) return;
        setSchema(snapshot);
        if (snapshot.schemas.length > 0) {
          const firstSchema = snapshot.schemas[0];
          setSelectedSchemaName(firstSchema.name);
          if (firstSchema.relations.length > 0) {
            setSelectedRelationName(firstSchema.relations[0].name);
          }
        }
      })
      .catch((err) => {
        if (schemaGenerationRef.current !== currentGeneration) return;
        if (err?.status === 401) onUnauthorizedRef.current();
        else setError(err?.message ?? 'Không thể tải schema');
      })
      .finally(() => {
        if (schemaGenerationRef.current === currentGeneration) {
          setLoadingSchema(false);
        }
      });
  }, [selectedTargetId]);

  // Select relation
  const selectRelation = useCallback((schemaName: string, relationName: string) => {
    rowsGenerationRef.current += 1;
    setSelectedSchemaName(schemaName);
    setSelectedRelationName(relationName);
    setRows(null);
    setCursorStack([]);
    setCurrentCursor(undefined);
    setFilters([]);
    setSort(undefined);
    setSelectedCell(null);
    setRelatedRowsDrawer(null);
    setError(null);
  }, []);

  // Load rows for maintainer/owner
  const loadRows = useCallback(() => {
    if (!selectedTargetId || !selectedSchemaName || !selectedRelationName || isViewer) {
      return;
    }

    const currentGeneration = ++rowsGenerationRef.current;
    setLoadingRows(true);
    setError(null);

    queryDatabaseRows(
      selectedTargetId,
      {
        schema: selectedSchemaName,
        relation: selectedRelationName,
        pageSize,
        cursor: currentCursor,
        sort,
        filters,
        piiMode: piiReveal.active ? 'revealed' : 'masked'
      },
      session.csrfToken ?? ''
    )
      .then((res) => {
        if (rowsGenerationRef.current !== currentGeneration) return;
        setRows(res);
      })
      .catch((err) => {
        if (rowsGenerationRef.current !== currentGeneration) return;
        if (err?.status === 401) onUnauthorizedRef.current();
        else setError(err?.code ?? err?.message ?? 'Không thể tải dữ liệu bảng');
      })
      .finally(() => {
        if (rowsGenerationRef.current === currentGeneration) {
          setLoadingRows(false);
        }
      });
  }, [
    selectedTargetId,
    selectedSchemaName,
    selectedRelationName,
    pageSize,
    currentCursor,
    sort,
    filters,
    piiReveal.active,
    isViewer,
    session.csrfToken
  ]);

  // Trigger loadRows when relation, pagination, sort, or filters change
  useEffect(() => {
    if (selectedTargetId && selectedSchemaName && selectedRelationName && !isViewer) {
      loadRows();
    }
  }, [
    selectedTargetId,
    selectedSchemaName,
    selectedRelationName,
    pageSize,
    currentCursor,
    sort,
    filters,
    isViewer
  ]);

  // Pagination helpers
  const goToNextPage = useCallback(() => {
    if (rows?.nextCursor) {
      setCursorStack((prev) => [...prev, currentCursor ?? '']);
      setCurrentCursor(rows.nextCursor);
    }
  }, [rows?.nextCursor, currentCursor]);

  const goToPreviousPage = useCallback(() => {
    if (cursorStack.length > 0) {
      const prevCursor = cursorStack[cursorStack.length - 1];
      setCursorStack((prev) => prev.slice(0, -1));
      setCurrentCursor(prevCursor || undefined);
    }
  }, [cursorStack]);

  // Privacy reveal
  const handleReveal = useCallback(
    async (password: string, token: string, reason: string) => {
      if (!selectedTargetId || !session.csrfToken) return;
      try {
        const res = await revealDatabasePii(
          selectedTargetId,
          { password, token, reason },
          session.csrfToken
        );
        setPiiReveal({ active: true, expiresAt: res.expiresAt });
        setIsRevealDialogOpen(false);
        // Reload rows with revealed mode
        rowsGenerationRef.current += 1;
        setLoadingRows(true);
        const newRows = await queryDatabaseRows(
          selectedTargetId,
          {
            schema: selectedSchemaName ?? 'public',
            relation: selectedRelationName ?? '',
            pageSize,
            cursor: currentCursor,
            sort,
            filters,
            piiMode: 'revealed'
          },
          session.csrfToken
        );
        setRows(newRows);
      } catch (err: any) {
        if (err?.status === 401) onUnauthorizedRef.current();
        else throw err;
      } finally {
        setLoadingRows(false);
      }
    },
    [
      selectedTargetId,
      session.csrfToken,
      selectedSchemaName,
      selectedRelationName,
      pageSize,
      currentCursor,
      sort,
      filters
    ]
  );

  // Privacy hide
  const handleHide = useCallback(async () => {
    if (!selectedTargetId || !session.csrfToken) return;
    setRows(null); // Clear rows first!
    setPiiReveal({ active: false, expiresAt: null });
    try {
      await hideDatabasePii(selectedTargetId, session.csrfToken);
    } catch {
      // ignore hide failure
    }
    // Reload rows with masked mode
    if (selectedSchemaName && selectedRelationName && !isViewer) {
      rowsGenerationRef.current += 1;
      setLoadingRows(true);
      try {
        const masked = await queryDatabaseRows(
          selectedTargetId,
          {
            schema: selectedSchemaName,
            relation: selectedRelationName,
            pageSize,
            cursor: currentCursor,
            sort,
            filters,
            piiMode: 'masked'
          },
          session.csrfToken
        );
        setRows(masked);
      } catch (err: any) {
        if (err?.status === 401) onUnauthorizedRef.current();
      } finally {
        setLoadingRows(false);
      }
    }
  }, [
    selectedTargetId,
    session.csrfToken,
    selectedSchemaName,
    selectedRelationName,
    pageSize,
    currentCursor,
    sort,
    filters,
    isViewer
  ]);

  // Countdown timer for PII reveal expiry
  useEffect(() => {
    if (!piiReveal.active || !piiReveal.expiresAt) return;

    const interval = setInterval(() => {
      const remaining = Date.parse(piiReveal.expiresAt!) - Date.now();
      if (remaining <= 0) {
        void handleHide();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [piiReveal.active, piiReveal.expiresAt, handleHide]);

  // Current relation object
  const currentRelation: DatabaseExplorerRelation | null =
    schema?.schemas
      .find((s) => s.name === selectedSchemaName)
      ?.relations.find((r) => r.name === selectedRelationName) ?? null;

  return {
    targets,
    selectedTargetId,
    selectTarget,
    schema,
    selectedSchemaName,
    selectedRelationName,
    selectRelation,
    currentRelation,
    activeTab,
    setActiveTab,
    rows,
    pageSize,
    setPageSize,
    filters,
    setFilters,
    sort,
    setSort,
    cursorStack,
    currentCursor,
    goToNextPage,
    goToPreviousPage,
    selectedCell,
    setSelectedCell,
    relatedRowsDrawer,
    setRelatedRowsDrawer,
    piiReveal,
    isRevealDialogOpen,
    setIsRevealDialogOpen,
    handleReveal,
    handleHide,
    loadingTargets,
    loadingSchema,
    loadingRows,
    error,
    refreshRows: loadRows,
    isViewer
  };
}
