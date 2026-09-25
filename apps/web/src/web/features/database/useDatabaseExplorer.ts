import { captureBrowserException } from '../../telemetry/runtimeTelemetry.js';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../../api.js';
import type {
  DatabaseCell,
  DatabaseExplorerRelation,
  DatabaseExplorerSchemaSnapshot,
  DatabaseFilterOperator,
  DatabasePageSize,
  DatabaseRelationEdge,
  DatabaseRowsResponse,
  DatabaseTargetId,
  DatabaseTargetSummary
} from '../../../../../../packages/contracts/src/databaseExplorer.js';
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

type RelatedRowsDrawerState = {
  open: boolean;
  edge: DatabaseRelationEdge;
  rowRef: string;
  sourceSchema: string;
  sourceRelation: string;
  targetId: DatabaseTargetId;
  schemaChecksum: string | null;
  loading: boolean;
  rows: DatabaseRowsResponse | null;
  error?: string | null;
  cursorStack: string[];
  currentCursor?: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    if (typeof value['code'] === 'string') return value['code'];
    if (typeof value['message'] === 'string') return value['message'];
  }
  return fallback;
}

export function useDatabaseExplorer({ session, onUnauthorized }: UseDatabaseExplorerProps) {
  const [targets, setTargets] = useState<DatabaseTargetSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<DatabaseTargetId | null>(null);
  const [schemaLoadVersion, setSchemaLoadVersion] = useState(0);
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

  const [relatedRowsDrawer, setRelatedRowsDrawer] = useState<RelatedRowsDrawerState | null>(null);

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
  const relatedRowsGenerationRef = useRef(0);
  const privacyTransitionGenerationRef = useRef(0);
  const rowsSuppressedRef = useRef(false);
  const privacyTransitionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revealRequestRef = useRef<Promise<{ expiresAt: string }> | null>(null);
  const serverGrantMayExistRef = useRef(false);
  const pendingRevocationsRef = useRef(0);
  const csrfTokenRef = useRef(session.csrfToken);
  csrfTokenRef.current = session.csrfToken;
  const schemaSnapshotRef = useRef<DatabaseExplorerSchemaSnapshot | null>(null);
  const selectedTargetIdRef = useRef(selectedTargetId);
  const selectedSchemaNameRef = useRef(selectedSchemaName);
  const selectedRelationNameRef = useRef(selectedRelationName);
  selectedTargetIdRef.current = selectedTargetId;
  selectedSchemaNameRef.current = selectedSchemaName;
  selectedRelationNameRef.current = selectedRelationName;
  const piiRevealActiveRef = useRef(piiReveal.active);
  piiRevealActiveRef.current = piiReveal.active;
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
        void captureBrowserException(err, {
          code: 'UNHANDLED_PROMISE_REJECTION',
          source: 'browser',
          route: () => globalThis.location?.pathname
        });
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

  const clearRowsAndSensitiveLayers = useCallback(() => {
    const generation = ++privacyTransitionGenerationRef.current;
    rowsGenerationRef.current += 1;
    relatedRowsGenerationRef.current += 1;
    rowsSuppressedRef.current = true;
    piiRevealActiveRef.current = false;
    setRows(null);
    setLoadingRows(false);
    setSelectedCell(null);
    setRelatedRowsDrawer(null);
    setCursorStack([]);
    setCurrentCursor(undefined);
    setPiiReveal({ active: false, expiresAt: null });
    return generation;
  }, []);

  const revokePrivacy = useCallback(
    (generation: number, pendingReveal: Promise<{ expiresAt: string }> | null) => {
      pendingRevocationsRef.current += 1;
      const operation = privacyTransitionQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (pendingReveal) await pendingReveal.catch(() => undefined);
          await hideDatabasePii(csrfTokenRef.current ?? '', { keepalive: true });
          serverGrantMayExistRef.current = false;
          return privacyTransitionGenerationRef.current === generation;
        });
      const trackedOperation = operation.finally(() => {
        pendingRevocationsRef.current = Math.max(0, pendingRevocationsRef.current - 1);
      });
      privacyTransitionQueueRef.current = trackedOperation.then(
        () => undefined,
        () => undefined
      );
      return trackedOperation;
    },
    []
  );

  // Keep an active server-side grant from surviving navigation away from this page.
  useEffect(() => {
    return () => {
      if (!serverGrantMayExistRef.current && !piiRevealActiveRef.current) return;
      clearRowsAndSensitiveLayers();
      if (pendingRevocationsRef.current > 0) return;

      pendingRevocationsRef.current += 1;
      void hideDatabasePii(csrfTokenRef.current ?? '', { keepalive: true })
        .then(() => {
          serverGrantMayExistRef.current = false;
        })
        .catch(() => undefined)
        .finally(() => {
          pendingRevocationsRef.current = Math.max(0, pendingRevocationsRef.current - 1);
        });
    };
  }, [clearRowsAndSensitiveLayers]);

  // Clear synchronously, revoke globally, then allow the target schema request.
  const selectTarget = useCallback(
    async (targetId: DatabaseTargetId) => {
      if (selectedTargetId === targetId && schema) return;
      if (!selectedTargetId) {
        setSelectedTargetId(targetId);
        return;
      }

      const generation = clearRowsAndSensitiveLayers();
      const pendingReveal = revealRequestRef.current;
      schemaGenerationRef.current += 1;
      schemaSnapshotRef.current = null;
      setSchema(null);
      setSelectedSchemaName(null);
      setSelectedRelationName(null);
      setFilters([]);
      setSort(undefined);
      setIsRevealDialogOpen(false);
      setLoadingSchema(true);
      setError(null);

      try {
        const current = await revokePrivacy(generation, pendingReveal);
        if (!current) return;
        rowsSuppressedRef.current = false;
        if (targetId === selectedTargetId) setSchemaLoadVersion((previous) => previous + 1);
        else setSelectedTargetId(targetId);
      } catch (err: unknown) {
        if (privacyTransitionGenerationRef.current !== generation) return;
        if (err && typeof err === 'object' && (err as Record<string, unknown>)['status'] === 401) {
          onUnauthorizedRef.current();
        }
        setLoadingSchema(false);
        setError(getErrorMessage(err, 'Unable to revoke PII access before switching database'));
        void captureBrowserException(err, {
          code: 'UNHANDLED_BROWSER_EXCEPTION',
          source: 'browser',
          route: () => globalThis.location?.pathname
        });
      }
    },
    [selectedTargetId, schema, clearRowsAndSensitiveLayers, revokePrivacy]
  );

  // When selectedTargetId changes, fetch schema
  useEffect(() => {
    if (!selectedTargetId) return;
    const currentGeneration = ++schemaGenerationRef.current;
    setLoadingSchema(true);
    setError(null);

    getDatabaseSchema(selectedTargetId)
      .then((snapshot) => {
        if (schemaGenerationRef.current !== currentGeneration) return;
        const previousSnapshot = schemaSnapshotRef.current;
        if (
          previousSnapshot?.targetId === snapshot.targetId &&
          previousSnapshot.checksum !== snapshot.checksum
        ) {
          rowsGenerationRef.current += 1;
          relatedRowsGenerationRef.current += 1;
          setRows(null);
          setCursorStack([]);
          setCurrentCursor(undefined);
          setSelectedCell(null);
          setRelatedRowsDrawer(null);
        }
        schemaSnapshotRef.current = snapshot;
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
        void captureBrowserException(err, {
          code: 'UNHANDLED_PROMISE_REJECTION',
          source: 'browser',
          route: () => globalThis.location?.pathname
        });
        if (schemaGenerationRef.current !== currentGeneration) return;
        if (err?.status === 401) onUnauthorizedRef.current();
        else setError(err?.message ?? 'Không thể tải schema');
      })
      .finally(() => {
        if (schemaGenerationRef.current === currentGeneration) {
          setLoadingSchema(false);
        }
      });
  }, [selectedTargetId, schemaLoadVersion]);

  // Select relation
  const selectRelation = useCallback((schemaName: string, relationName: string) => {
    rowsGenerationRef.current += 1;
    relatedRowsGenerationRef.current += 1;
    setSelectedSchemaName(schemaName);
    setSelectedRelationName(relationName);
    setRows(null);
    setLoadingRows(false);
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
    if (
      rowsSuppressedRef.current ||
      !selectedTargetId ||
      !selectedSchemaName ||
      !selectedRelationName ||
      isViewer
    ) {
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
        void captureBrowserException(err, {
          code: 'UNHANDLED_PROMISE_REJECTION',
          source: 'browser',
          route: () => globalThis.location?.pathname
        });
        if (rowsGenerationRef.current !== currentGeneration) return;
        if (err?.status === 401) onUnauthorizedRef.current();
        else setError(getErrorMessage(err, 'Không thể tải dữ liệu bảng'));
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

  const toggleSort = useCallback((column: string) => {
    setCursorStack([]);
    setCurrentCursor(undefined);
    setSort((prev) => {
      if (prev?.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        return undefined;
      }
      return { column, direction: 'asc' };
    });
  }, []);

  const addFilter = useCallback((filter: DatabaseFilter) => {
    setCursorStack([]);
    setCurrentCursor(undefined);
    setFilters((prev) => (prev.length < 5 ? [...prev, filter] : prev));
  }, []);

  const removeFilter = useCallback((index: number) => {
    setCursorStack([]);
    setCurrentCursor(undefined);
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const loadRelatedPage = useCallback(
    async (
      drawer: RelatedRowsDrawerState,
      cursor: string | undefined,
      cursorStack: string[],
      generation: number
    ) => {
      setRelatedRowsDrawer((prev) =>
        prev
          ? { ...prev, loading: true, rows: null, error: null, cursorStack, currentCursor: cursor }
          : null
      );
      try {
        const response = await queryRelatedRows(
          drawer.targetId,
          {
            schema: drawer.sourceSchema,
            relation: drawer.sourceRelation,
            constraint: drawer.edge.constraint,
            rowRef: drawer.rowRef,
            pageSize: 25,
            cursor,
            piiMode: piiReveal.active ? 'revealed' : 'masked'
          },
          session.csrfToken ?? ''
        );
        if (relatedRowsGenerationRef.current !== generation) return;
        if (schemaSnapshotRef.current?.checksum !== drawer.schemaChecksum) return;
        setRelatedRowsDrawer((prev) =>
          prev
            ? { ...prev, loading: false, rows: response, cursorStack, currentCursor: cursor }
            : null
        );
      } catch (err: unknown) {
        void captureBrowserException(err, {
          code: 'UNHANDLED_BROWSER_EXCEPTION',
          source: 'browser',
          route: () => globalThis.location?.pathname
        });
        if (relatedRowsGenerationRef.current !== generation) return;
        if (err && typeof err === 'object' && (err as Record<string, unknown>)['status'] === 401) {
          onUnauthorizedRef.current();
        }
        setRelatedRowsDrawer((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                error: getErrorMessage(err, 'Error loading related rows')
              }
            : null
        );
      }
    },
    [session.csrfToken, piiReveal.active]
  );

  const followRelation = useCallback(
    async (edge: DatabaseRelationEdge, rowRef: string) => {
      if (!selectedTargetId || !selectedSchemaName || !selectedRelationName || !session.csrfToken) {
        return;
      }
      const drawer: RelatedRowsDrawerState = {
        open: true,
        edge,
        rowRef,
        sourceSchema: selectedSchemaName,
        sourceRelation: selectedRelationName,
        targetId: selectedTargetId,
        schemaChecksum: schema?.checksum ?? null,
        loading: true,
        rows: null,
        error: null,
        cursorStack: [],
        currentCursor: undefined
      };
      const generation = ++relatedRowsGenerationRef.current;
      setRelatedRowsDrawer(drawer);
      await loadRelatedPage(drawer, undefined, [], generation);
    },
    [
      selectedTargetId,
      selectedSchemaName,
      selectedRelationName,
      session.csrfToken,
      schema?.checksum,
      loadRelatedPage
    ]
  );

  const goToRelatedNextPage = useCallback(async () => {
    const drawer = relatedRowsDrawer;
    const nextCursor = drawer?.rows?.nextCursor;
    if (!drawer?.open || drawer.loading || !nextCursor) return;
    const cursorStack = [...drawer.cursorStack, drawer.currentCursor ?? ''];
    await loadRelatedPage(drawer, nextCursor, cursorStack, relatedRowsGenerationRef.current);
  }, [relatedRowsDrawer, loadRelatedPage]);

  const goToRelatedPreviousPage = useCallback(async () => {
    const drawer = relatedRowsDrawer;
    if (!drawer?.open || drawer.loading || drawer.cursorStack.length === 0) return;
    const cursorStack = drawer.cursorStack.slice(0, -1);
    const previousCursor = drawer.cursorStack[drawer.cursorStack.length - 1] || undefined;
    await loadRelatedPage(drawer, previousCursor, cursorStack, relatedRowsGenerationRef.current);
  }, [relatedRowsDrawer, loadRelatedPage]);

  const closeRelatedDrawer = useCallback(() => {
    relatedRowsGenerationRef.current += 1;
    setRelatedRowsDrawer(null);
  }, []);

  // Privacy reveal
  const handleReveal = useCallback(
    async (password: string, token: string, reason: string) => {
      if (!selectedTargetId || !selectedSchemaName || !selectedRelationName || !session.csrfToken) {
        throw new Error('Select a database table before revealing sensitive data');
      }
      if (rowsSuppressedRef.current)
        throw new Error('PII access is unavailable until revoke succeeds');

      const privacyGeneration = privacyTransitionGenerationRef.current;
      let rowsGeneration: number | null = null;
      let grantCreated = false;
      try {
        const revealRequest = revealDatabasePii(
          selectedTargetId,
          { password, token, reason },
          session.csrfToken
        );
        revealRequestRef.current = revealRequest;
        let revealResult: { expiresAt: string };
        try {
          revealResult = await revealRequest;
        } finally {
          if (revealRequestRef.current === revealRequest) revealRequestRef.current = null;
        }
        grantCreated = true;
        serverGrantMayExistRef.current = true;
        if (privacyTransitionGenerationRef.current !== privacyGeneration) return;

        rowsGeneration = ++rowsGenerationRef.current;
        setLoadingRows(true);
        const revealedRows = await queryDatabaseRows(
          selectedTargetId,
          {
            schema: selectedSchemaName,
            relation: selectedRelationName,
            pageSize,
            cursor: currentCursor,
            sort,
            filters,
            piiMode: 'revealed'
          },
          session.csrfToken
        );
        if (
          privacyTransitionGenerationRef.current !== privacyGeneration ||
          rowsGenerationRef.current !== rowsGeneration
        ) {
          return;
        }
        if (revealedRows.piiMode !== 'revealed') {
          throw new Error('The server did not return revealed database rows');
        }
        setRows(revealedRows);
        setPiiReveal({ active: true, expiresAt: revealResult.expiresAt });
        setIsRevealDialogOpen(false);
        setError(null);
      } catch (err: unknown) {
        void captureBrowserException(err, {
          code: 'UNHANDLED_BROWSER_EXCEPTION',
          source: 'browser',
          route: () => globalThis.location?.pathname
        });
        if (privacyTransitionGenerationRef.current !== privacyGeneration) return;
        if (err && typeof err === 'object' && (err as Record<string, unknown>)['status'] === 401) {
          onUnauthorizedRef.current();
        }
        setError(getErrorMessage(err, 'Unable to reveal database values'));
        if (grantCreated) {
          const generation = clearRowsAndSensitiveLayers();
          try {
            const current = await revokePrivacy(generation, null);
            if (!current) return;
            rowsSuppressedRef.current = false;

            const targetId = selectedTargetIdRef.current;
            const schemaName = selectedSchemaNameRef.current;
            const relationName = selectedRelationNameRef.current;
            if (!targetId || !schemaName || !relationName || isViewer) return;
            const recoveryRowsGeneration = ++rowsGenerationRef.current;
            setLoadingRows(true);
            try {
              const maskedRows = await queryDatabaseRows(
                targetId,
                {
                  schema: schemaName,
                  relation: relationName,
                  pageSize,
                  cursor: undefined,
                  sort,
                  filters,
                  piiMode: 'masked'
                },
                session.csrfToken
              );
              if (maskedRows.piiMode !== 'masked') {
                throw new Error('The server did not return masked database rows');
              }
              if (
                rowsGenerationRef.current === recoveryRowsGeneration &&
                privacyTransitionGenerationRef.current === generation &&
                selectedTargetIdRef.current === targetId &&
                selectedSchemaNameRef.current === schemaName &&
                selectedRelationNameRef.current === relationName
              ) {
                setRows(maskedRows);
              }
            } catch (recoveryError: unknown) {
              if (
                rowsGenerationRef.current === recoveryRowsGeneration &&
                privacyTransitionGenerationRef.current === generation
              ) {
                setError(getErrorMessage(recoveryError, 'Unable to reload masked database rows'));
              }
            } finally {
              if (rowsGenerationRef.current === recoveryRowsGeneration) setLoadingRows(false);
            }
          } catch (revokeError: unknown) {
            if (privacyTransitionGenerationRef.current === generation) {
              setError(getErrorMessage(revokeError, 'Unable to revoke PII access'));
            }
          }
        }
        throw err;
      } finally {
        if (rowsGeneration !== null && rowsGenerationRef.current === rowsGeneration) {
          setLoadingRows(false);
        }
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
      filters,
      clearRowsAndSensitiveLayers,
      revokePrivacy
    ]
  );

  // Clear synchronously, revoke globally, and reload masked rows only after success.
  const handleHide = useCallback(async () => {
    if (!selectedTargetId) return;
    const generation = clearRowsAndSensitiveLayers();
    const pendingReveal = revealRequestRef.current;
    setError(null);

    try {
      const current = await revokePrivacy(generation, pendingReveal);
      if (!current) return;
      rowsSuppressedRef.current = false;

      const targetId = selectedTargetIdRef.current;
      const schemaName = selectedSchemaNameRef.current;
      const relationName = selectedRelationNameRef.current;
      if (!targetId || !schemaName || !relationName || isViewer) return;
      const currentRowsGeneration = ++rowsGenerationRef.current;
      setLoadingRows(true);
      const maskedRows = await queryDatabaseRows(
        targetId,
        {
          schema: schemaName,
          relation: relationName,
          pageSize,
          cursor: undefined,
          sort,
          filters,
          piiMode: 'masked'
        },
        session.csrfToken ?? ''
      );
      if (maskedRows.piiMode !== 'masked') {
        throw new Error('The server did not return masked database rows');
      }
      if (
        rowsGenerationRef.current === currentRowsGeneration &&
        privacyTransitionGenerationRef.current === generation &&
        selectedTargetIdRef.current === targetId &&
        selectedSchemaNameRef.current === schemaName &&
        selectedRelationNameRef.current === relationName
      ) {
        setRows(maskedRows);
      }
    } catch (err: unknown) {
      void captureBrowserException(err, {
        code: 'UNHANDLED_BROWSER_EXCEPTION',
        source: 'browser',
        route: () => globalThis.location?.pathname
      });
      if (privacyTransitionGenerationRef.current === generation) {
        if (err && typeof err === 'object' && (err as Record<string, unknown>)['status'] === 401) {
          onUnauthorizedRef.current();
        }
        setError(getErrorMessage(err, 'Unable to revoke PII access'));
      }
    } finally {
      if (privacyTransitionGenerationRef.current === generation) setLoadingRows(false);
    }
  }, [
    selectedTargetId,
    session.csrfToken,
    pageSize,
    sort,
    filters,
    isViewer,
    clearRowsAndSensitiveLayers,
    revokePrivacy
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
    addFilter,
    removeFilter,
    sort,
    setSort,
    toggleSort,
    cursorStack,
    currentCursor,
    goToNextPage,
    goToPreviousPage,
    selectedCell,
    setSelectedCell,
    relatedRowsDrawer,
    setRelatedRowsDrawer,
    followRelation,
    closeRelatedDrawer,
    goToRelatedNextPage,
    goToRelatedPreviousPage,
    piiReveal,
    isRevealDialogOpen,
    setIsRevealDialogOpen,
    handleReveal,
    handleHide,
    clearRowsAndSensitiveLayers,
    loadingTargets,
    loadingSchema,
    loadingRows,
    error,
    refreshRows: loadRows,
    isViewer
  };
}
