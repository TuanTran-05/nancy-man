import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Receipt } from 'lucide-react';

type ReceiptRow = {
  id: string;
  ledgerId: string;
  receiptNumber: string | null;
  date: string | null;
  amount: number;
  method: string | null;
  status: string | null;
  source: string | null;
};

type Props = {
  ledgerId: string;
  receipts: ReceiptRow[];
  t: any;
};

function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

export const StudentLedgerReceipts: React.FC<Props> = ({ ledgerId, receipts, t }) => {
  const [expanded, setExpanded] = useState(false);
  const ledgerReceipts = receipts.filter((r) => r.ledgerId === ledgerId);

  if (ledgerReceipts.length === 0) return null;

  const rt = t.finance.receiptTable;

  return (
    <div className="mt-2">
      <button
        id={`ledger-receipts-toggle-${ledgerId}`}
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
      >
        <Receipt className="w-3.5 h-3.5" />
        {t.finance.table.receipts} ({ledgerReceipts.length})
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-2 overflow-x-auto rounded-xl border border-border-light">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 text-muted">
                <th className="px-3 py-2 text-left font-semibold">{rt.receiptNumber}</th>
                <th className="px-3 py-2 text-left font-semibold">{rt.date}</th>
                <th className="px-3 py-2 text-right font-semibold">{rt.amount}</th>
                <th className="px-3 py-2 text-left font-semibold">{rt.method}</th>
                <th className="px-3 py-2 text-left font-semibold">{rt.source}</th>
              </tr>
            </thead>
            <tbody>
              {ledgerReceipts.map((r) => (
                <tr key={r.id} className="border-t border-border-light">
                  <td className="px-3 py-2 font-mono">{r.receiptNumber ?? '—'}</td>
                  <td className="px-3 py-2">{r.date ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-600">
                    {formatVnd(r.amount)}
                  </td>
                  <td className="px-3 py-2">{r.method ?? '—'}</td>
                  <td className="px-3 py-2">{r.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
