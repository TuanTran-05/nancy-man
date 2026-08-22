import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  Banknote,
  ChevronDown,
  CreditCard,
  Loader2,
  Receipt,
  TrendingDown,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useParentTuitionData } from '../../hooks/useParentTuitionData';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { cn } from '../../lib/core/utils';
import { formatVndAmount } from '../../lib/core/moneyFormat';
import {
  createPayOSPayment,
  getPayOSPaymentStatus,
  type PayOSCreateResponse,
} from '../../lib/api/payosApi';
import type { CourseFeeLedger, LedgerStatus, Receipt as ReceiptType } from '../../types';
import { localize } from '../../lib/i18n/localize';
import {
  ledgerAmount,
  ledgerDiscountTotal,
  ledgerPaidTotal,
  ledgerRemaining,
} from '../../../shared/money';
import { parentReceiptsForLedger } from './parentTuitionReceipts';

type SortOrder = 'newest' | 'oldest';
type StatusFilter = 'all' | LedgerStatus;
type CheckoutState = PayOSCreateResponse & { ledgerId: string };
const PAYOS_EMBEDDED_ELEMENT_ID = 'payos-embedded-checkout';
const PAYOS_CHECKOUT_AVAILABLE = import.meta.env.VITE_PAYOS_ENABLED === 'true';

declare global {
  interface Window {
    PayOSCheckout?: {
      usePayOS: (config: {
        RETURN_URL: string;
        ELEMENT_ID: string;
        CHECKOUT_URL: string;
        embedded: boolean;
        onSuccess?: (event?: unknown) => void;
        onCancel?: (event?: unknown) => void;
        onExit?: (event?: unknown) => void;
      }) => { open: () => void; exit: () => void };
    };
  }
}

export default function ParentTuition() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const { feeLedgers, feeReceipts, loading } = useParentTuitionData(profile);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [expandedLedgerId, setExpandedLedgerId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [payingLedgerId, setPayingLedgerId] = useState<string | null>(null);

  const fmt = (n: number) => `${formatVndAmount(n)}đ`;

  const handlePayOSPayment = async (ledger: CourseFeeLedger) => {
    if (!PAYOS_CHECKOUT_AVAILABLE) {
      toast(t.parent.payOSInDevelopment, { icon: '🚧' });
      return;
    }

    try {
      setPayingLedgerId(ledger.id);
      const payment = await createPayOSPayment(ledger.id);
      setCheckout({ ...payment, ledgerId: ledger.id });
    } catch (err) {
      console.error('payOS create payment failed:', err);
      toast.error(t.parent.payOSLinkError);
    } finally {
      setPayingLedgerId(null);
    }
  };
  const closeCheckout = useCallback(() => setCheckout(null), []);

  // Summary stats (unfiltered)
  const summary = useMemo(() => {
    const totalFee = feeLedgers.reduce((s, l) => s + ledgerAmount(l), 0);
    const totalDiscount = feeLedgers.reduce((s, l) => s + ledgerDiscountTotal(l), 0);
    const totalPaid = feeLedgers.reduce((s, l) => s + ledgerPaidTotal(l), 0);
    const totalRemaining = feeLedgers.reduce((s, l) => s + ledgerRemaining(l), 0);
    return { totalFee, totalDiscount, totalPaid, totalRemaining };
  }, [feeLedgers]);

  // Filter + sort
  const filteredLedgers = useMemo(() => {
    let result = [...feeLedgers];
    if (statusFilter !== 'all') {
      result = result.filter((l) => l.status === statusFilter);
    }
    result.sort((a, b) => {
      const aDate = a.termStart || a.createdAt || '';
      const bDate = b.termStart || b.createdAt || '';
      return sortOrder === 'newest' ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
    });
    return result;
  }, [feeLedgers, statusFilter, sortOrder]);

  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      paid: {
        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
        label: t.parent.paid,
      },
      partial: {
        cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
        label: t.parent.partial,
      },
      unpaid: {
        cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400',
        label: t.parent.unpaid,
      },
      waived: {
        cls: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400',
        label: t.parent.waived,
      },
    };
    const s = map[status] || map.unpaid;
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>
        {s.label}
      </span>
    );
  };

  const filterChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t.parent.all },
    { key: 'unpaid', label: t.parent.unpaid },
    { key: 'partial', label: t.parent.partial },
    { key: 'paid', label: t.parent.paid },
    { key: 'waived', label: t.parent.waived },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 lg:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-300" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t.parent.tuition}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t.parent.trackTuition}</p>
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OverviewCard
          icon={Banknote}
          label={t.parent.totalFee}
          value={fmt(summary.totalFee)}
          color="blue"
        />
        <OverviewCard
          icon={CreditCard}
          label={t.parent.paid}
          value={fmt(summary.totalPaid)}
          color="emerald"
        />
        <OverviewCard
          icon={Receipt}
          label={t.parent.discount}
          value={fmt(summary.totalDiscount)}
          color="violet"
        />
        <OverviewCard
          icon={TrendingDown}
          label={t.parent.remaining}
          value={fmt(summary.totalRemaining)}
          color={summary.totalRemaining > 0 ? 'rose' : 'emerald'}
        />
      </div>

      {/* Filters + Sort */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setStatusFilter(chip.key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                statusFilter === chip.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="px-3 py-1.5 rounded-lg text-sm border border-slate-100 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200"
        >
          <option value="newest">{t.parent.newest}</option>
          <option value="oldest">{t.parent.oldest}</option>
        </select>
      </div>

      {/* Ledger list */}
      <div className="space-y-4">
        {filteredLedgers.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Banknote className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">{t.parent.noTuitionData}</p>
          </div>
        ) : (
          filteredLedgers.map((ledger) => (
            <LedgerCard
              key={ledger.id}
              ledger={ledger}
              receipts={feeReceipts}
              expanded={expandedLedgerId === ledger.id}
              onToggle={() =>
                setExpandedLedgerId((prev) => (prev === ledger.id ? null : ledger.id))
              }
              statusBadge={statusBadge}
              fmt={fmt}
              onPay={handlePayOSPayment}
              paying={payingLedgerId === ledger.id}
            />
          ))
        )}
      </div>

      {checkout && <PayOSEmbeddedCheckout checkout={checkout} fmt={fmt} onClose={closeCheckout} />}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function OverviewCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: 'blue' | 'emerald' | 'violet' | 'rose';
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
  };

  return (
    <div className="rounded-2xl border border-slate-100/70 dark:border-slate-700/60 bg-white/90 dark:bg-slate-800/90 p-4 shadow-sm">
      <div className={cn('inline-flex rounded-xl p-2 mb-2', colorMap[color])}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
      <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

function LedgerCard({
  ledger,
  receipts,
  expanded,
  onToggle,
  statusBadge,
  fmt,
  onPay,
  paying,
}: {
  ledger: CourseFeeLedger;
  receipts: ReceiptType[];
  expanded: boolean;
  onToggle: () => void;
  statusBadge: (status: string) => React.ReactNode;
  fmt: (n: number) => string;
  onPay: (ledger: CourseFeeLedger) => void;
  paying: boolean;
}) {
  const { t } = useLanguage();
  const ledgerReceipts = parentReceiptsForLedger(receipts, ledger.id).sort((a, b) =>
    (b.receivedDate || '').localeCompare(a.receivedDate || '')
  );
  const amount = ledgerAmount(ledger);
  const discountTotal = ledgerDiscountTotal(ledger);
  const paidTotal = ledgerPaidTotal(ledger);
  const remaining = ledgerRemaining(ledger);

  return (
    <div className="rounded-2xl border border-slate-100/70 dark:border-slate-700/60 bg-white/90 dark:bg-slate-800/90 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex justify-between items-start mb-3">
          <div>
            {ledger.termStart && ledger.termEnd && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {ledger.termStart} &mdash; {ledger.termEnd}
              </p>
            )}
          </div>
          {statusBadge(ledger.status)}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t.parent.fee}</div>
            <div className="font-semibold text-slate-700 dark:text-slate-200">{fmt(amount)}</div>
          </div>
          {discountTotal > 0 && (
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                {t.parent.discount}
              </div>
              <div className="font-semibold text-violet-600 dark:text-violet-400">
                -{fmt(discountTotal)}
              </div>
            </div>
          )}
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t.parent.paid}</div>
            <div className="font-semibold text-emerald-600 dark:text-emerald-400">
              {fmt(paidTotal)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
              {t.parent.remaining}
            </div>
            <div
              className={cn(
                'font-semibold',
                remaining > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              )}
            >
              {fmt(remaining)}
            </div>
          </div>
        </div>

        {ledgerReceipts.length > 0 && (
          <button
            type="button"
            onClick={onToggle}
            className="mt-4 flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ChevronDown className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')} />
            {t.parent.paymentHistory} ({ledgerReceipts.length})
          </button>
        )}
        {remaining > 0 && (ledger.status === 'unpaid' || ledger.status === 'partial') && (
          <button
            type="button"
            onClick={() => onPay(ledger)}
            disabled={paying}
            className="mt-4 inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {paying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            <span>{paying ? t.parent.creatingPayment : t.parent.payWithPayOS}</span>
            {!PAYOS_CHECKOUT_AVAILABLE && !paying && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                {t.parent.inDevelopment}
              </span>
            )}
          </button>
        )}
      </div>

      {expanded && ledgerReceipts.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/50 px-5 py-4">
          <div className="space-y-2">
            {ledgerReceipts.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white dark:bg-slate-800 px-4 py-3 border border-slate-100 dark:border-slate-700/40"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {r.receiptNo}
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {r.receivedDate}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {r.discountAmount && r.discountAmount > 0 && (
                    <span className="text-xs text-violet-500">-{fmt(r.discountAmount)}</span>
                  )}
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    +{fmt(r.amountReceived)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PayOSEmbeddedCheckout({
  checkout,
  onClose,
  fmt,
}: {
  checkout: CheckoutState;
  onClose: () => void;
  fmt: (n: number) => string;
}) {
  const { language, t } = useLanguage();
  const [message, setMessage] = useState(t.parent.loadingCheckout);
  const [confirmed, setConfirmed] = useState(false);
  const payosInstanceRef = useRef<{ open: () => void; exit: () => void } | null>(null);
  const exitedRef = useRef(false);

  const safeExitPayOS = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;

    if (!document.getElementById(PAYOS_EMBEDDED_ELEMENT_ID)) return;

    try {
      payosInstanceRef.current?.exit();
    } catch {
      // payOS owns iframe internals and may already have closed itself.
    }
  }, []);

  const closeCheckout = useCallback(() => {
    safeExitPayOS();
    onClose();
  }, [onClose, safeExitPayOS]);

  useEffect(() => {
    let cancelled = false;
    let polling = false;
    let pollTimer: number | null = null;
    let closeTimer: number | null = null;

    payosInstanceRef.current = null;
    exitedRef.current = false;

    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const pollStatusOnce = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const status = await getPayOSPaymentStatus(checkout.orderCode);
        if (status.status === 'paid') {
          stopPolling();
          setConfirmed(true);
          setMessage(t.parent.paymentConfirmed);
          closeTimer = window.setTimeout(closeCheckout, 1800);
          return;
        }
        if (
          status.status === 'failed' ||
          status.status === 'stale' ||
          status.status === 'needs_review'
        ) {
          stopPolling();
          setMessage(t.parent.paymentReview);
        }
      } catch (err) {
        console.error('payOS status polling failed:', err);
      } finally {
        polling = false;
      }
    };

    const startPolling = () => {
      if (pollTimer !== null) return;
      void pollStatusOnce();
      pollTimer = window.setInterval(() => {
        void pollStatusOnce();
      }, 2500);
    };

    const loadScript = () =>
      new Promise<void>((resolve, reject) => {
        if (window.PayOSCheckout) {
          resolve();
          return;
        }

        const existing = document.querySelector<HTMLScriptElement>('script[data-payos-checkout]');
        if (existing) {
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener(
            'error',
            () => reject(new Error('Cannot load payOS checkout')),
            {
              once: true,
            }
          );
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.payos.vn/payos-checkout/v1/stable/payos-initialize.js';
        script.async = true;
        script.dataset.payosCheckout = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Cannot load payOS checkout'));
        document.body.appendChild(script);
      });

    loadScript()
      .then(() => {
        if (cancelled || !window.PayOSCheckout) return;
        payosInstanceRef.current = window.PayOSCheckout.usePayOS({
          RETURN_URL: checkout.returnUrl || window.location.href,
          ELEMENT_ID: PAYOS_EMBEDDED_ELEMENT_ID,
          CHECKOUT_URL: checkout.checkoutUrl,
          embedded: true,
          onSuccess: () => {
            setMessage(
              localize(
                language,
                'Đã thanh toán, hệ thống đang xác nhận từ payOS...',
                'Payment received, waiting for payOS confirmation...'
              )
            );
            startPolling();
          },
          onCancel: () => {
            setMessage(t.parent.paymentCancelled);
          },
          onExit: () => {
            setMessage(t.parent.checkoutClosed);
          },
        });
        payosInstanceRef.current.open();
        setMessage(t.parent.scanQR);
        startPolling();
      })
      .catch((err) => {
        console.error(err);
        setMessage(t.parent.loadCheckoutError);
      });

    return () => {
      cancelled = true;
      stopPolling();
      if (closeTimer !== null) {
        window.clearTimeout(closeTimer);
      }
      safeExitPayOS();
    };
  }, [
    checkout.checkoutUrl,
    checkout.orderCode,
    checkout.returnUrl,
    closeCheckout,
    safeExitPayOS,
    t,
  ]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.parent.tuitionPayment}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {fmt(checkout.amount)} · #{checkout.orderCode}
            </p>
          </div>
          <button
            type="button"
            onClick={closeCheckout}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="h-[min(720px,calc(92vh-9rem))] min-h-[520px] overflow-hidden p-4">
          <div
            id={PAYOS_EMBEDDED_ELEMENT_ID}
            className="payos-checkout-zoom h-full min-h-[488px] w-full"
          />
        </div>

        <div
          className={cn(
            'border-t px-5 py-3 text-sm',
            confirmed
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-slate-100 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
          )}
        >
          {message}
        </div>
      </div>
    </div>
  );
}
