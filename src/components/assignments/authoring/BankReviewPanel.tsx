import { useEffect, useState } from 'react';
import {
  reviewQuestionBankItem,
  searchQuestionBank,
} from '../../../lib/api/assignmentAuthoringApi';

interface PendingBankItem {
  id: string;
  prompt: string;
  visibility: string;
}

export function BankReviewPanel() {
  const [items, setItems] = useState<PendingBankItem[]>([]);

  const load = () => {
    searchQuestionBank<PendingBankItem>({ visibility: 'pending_review' })
      .then((result) => setItems(result.items))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const review = async (id: string, decision: 'approve' | 'reject') => {
    await reviewQuestionBankItem({ id, decision });
    load();
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-black uppercase text-slate-500">Review queue</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No items pending review.</p>
      ) : (
        items.map((item) => (
          <article
            key={item.id}
            className="rounded-md border border-slate-200 p-3 bg-white shadow-xs"
          >
            <p className="text-sm font-bold text-slate-900">{item.prompt}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void review(item.id, 'approve')}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => void review(item.id, 'reject')}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Reject
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
