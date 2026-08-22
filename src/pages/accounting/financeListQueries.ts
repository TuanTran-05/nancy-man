import { infiniteQueryOptions } from '@tanstack/react-query';
import { readChannel } from '../../lib/api/readApi';
import { listPayOSPayments } from '../../lib/api/payosApi';
import type { CourseFeeLedger, Expense, OnlinePaymentRequest, Receipt } from '../../types';
import { PAYMENT_PAGE_SIZE, RECENT_FINANCE_DOC_LIMIT } from './constants';

/**
 * Short, not long. These four lists are what accounting collects against, so
 * they cannot take the 15 minutes the reference data and roster queries use.
 * A minute is enough to make rapid tab switching free while keeping the worst
 * case bounded — and it is only ever reached if a realtime bump was missed,
 * since `finance-ledger`, `finance-receipt`, `finance-expense` and
 * `parent-tuition` already force a refetch the moment money moves.
 */
export const FINANCE_LIST_STALE_TIME_MS = 60_000;
export const FINANCE_LIST_GC_TIME_MS = 30 * 60_000;

const sharedFinanceListOptions = {
  staleTime: FINANCE_LIST_STALE_TIME_MS,
  gcTime: FINANCE_LIST_GC_TIME_MS,
  refetchInterval: FINANCE_LIST_STALE_TIME_MS,
  refetchIntervalInBackground: false,
  retry: false,
} as const;

type FinanceListIdentity = {
  uid: string;
  role: string;
};

export type FinanceLedgerFilters = { status: string; classId: string };
export type FinanceReceiptFilters = {
  status: string;
  classId: string;
  startDate: string;
  endDate: string;
};
export type FinanceExpenseFilters = { status: string; startDate: string; endDate: string };
export type FinancePaymentFilters = { status: string };

export type PaymentHealth = {
  pendingOlderThan30m: number;
  needsReviewOpen: number;
  staleCreatingGatewaySession: number;
  failedWebhookEvents24h: number;
};

type ListPage<T> = {
  rows: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

type PaymentsListPage = ListPage<OnlinePaymentRequest> & { health?: PaymentHealth };

type ServerPage = { nextCursor?: string | null; hasMore?: boolean } | undefined;

function toListPage<T>(rows: T[] | undefined, page: ServerPage): ListPage<T> {
  return {
    rows: rows || [],
    nextCursor: page?.nextCursor || null,
    hasMore: page?.hasMore === true,
  };
}

export const financeListQueryKeys = {
  ledgers: ({ uid, role }: FinanceListIdentity, filters: FinanceLedgerFilters) =>
    ['finance-list', uid, role, 'ledgers', filters] as const,
  receipts: ({ uid, role }: FinanceListIdentity, filters: FinanceReceiptFilters) =>
    ['finance-list', uid, role, 'receipts', filters] as const,
  expenses: ({ uid, role }: FinanceListIdentity, filters: FinanceExpenseFilters) =>
    ['finance-list', uid, role, 'expenses', filters] as const,
  payments: ({ uid, role }: FinanceListIdentity, filters: FinancePaymentFilters) =>
    ['finance-list', uid, role, 'payments', filters] as const,
};

export function financeLedgersQueryOptions(
  identity: FinanceListIdentity,
  filters: FinanceLedgerFilters,
  enabled: boolean
) {
  return infiniteQueryOptions({
    queryKey: financeListQueryKeys.ledgers(identity, filters),
    queryFn: async ({ pageParam }) => {
      const data = await readChannel<{
        ledgers?: CourseFeeLedger[];
        page?: { nextCursor: string | null; hasMore: boolean };
      }>('finance', {
        resource: 'ledgers',
        limit: RECENT_FINANCE_DOC_LIMIT,
        cursor: pageParam,
        status: filters.status,
        classId: filters.classId,
      });
      return toListPage(data.ledgers, data.page);
    },
    enabled,
    ...sharedFinanceListOptions,
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListPage<CourseFeeLedger>) =>
      last.hasMore ? last.nextCursor : undefined,
  });
}

export function financeReceiptsQueryOptions(
  identity: FinanceListIdentity,
  filters: FinanceReceiptFilters,
  enabled: boolean
) {
  return infiniteQueryOptions({
    queryKey: financeListQueryKeys.receipts(identity, filters),
    queryFn: async ({ pageParam }) => {
      const data = await readChannel<{
        receipts?: Receipt[];
        page?: { nextCursor: string | null; hasMore: boolean };
      }>('finance', {
        resource: 'receipts',
        limit: RECENT_FINANCE_DOC_LIMIT,
        cursor: pageParam,
        status: filters.status,
        classId: filters.classId,
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      return toListPage(data.receipts, data.page);
    },
    enabled,
    ...sharedFinanceListOptions,
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListPage<Receipt>) => (last.hasMore ? last.nextCursor : undefined),
  });
}

export function financeExpensesQueryOptions(
  identity: FinanceListIdentity,
  filters: FinanceExpenseFilters,
  enabled: boolean
) {
  return infiniteQueryOptions({
    queryKey: financeListQueryKeys.expenses(identity, filters),
    queryFn: async ({ pageParam }) => {
      const data = await readChannel<{
        expenses?: Expense[];
        page?: { nextCursor: string | null; hasMore: boolean };
      }>('finance', {
        resource: 'expenses',
        limit: RECENT_FINANCE_DOC_LIMIT,
        cursor: pageParam,
        status: filters.status,
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      return toListPage(data.expenses, data.page);
    },
    enabled,
    ...sharedFinanceListOptions,
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListPage<Expense>) => (last.hasMore ? last.nextCursor : undefined),
  });
}

export function financePaymentsQueryOptions(
  identity: FinanceListIdentity,
  filters: FinancePaymentFilters,
  enabled: boolean
) {
  return infiniteQueryOptions({
    queryKey: financeListQueryKeys.payments(identity, filters),
    queryFn: async ({ pageParam }) => {
      const result = await listPayOSPayments(filters.status, PAYMENT_PAGE_SIZE, pageParam);
      const page: PaymentsListPage = {
        ...toListPage<OnlinePaymentRequest>(result.payments, result.page),
        health: result.health,
      };
      return page;
    },
    enabled,
    ...sharedFinanceListOptions,
    initialPageParam: null as string | null,
    getNextPageParam: (last: PaymentsListPage) => (last.hasMore ? last.nextCursor : undefined),
  });
}
