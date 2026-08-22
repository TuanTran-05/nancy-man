import { useEffect, useState } from 'react';
import type { AssessmentQuestionBankItem } from '../../../../shared/assignmentAuthoring';
import { searchQuestionBank } from '../../../lib/api/assignmentAuthoringApi';

interface QuestionBankPanelProps {
  onInsert: (item: AssessmentQuestionBankItem) => void;
}

export function QuestionBankPanel({ onInsert }: QuestionBankPanelProps) {
  const [items, setItems] = useState<AssessmentQuestionBankItem[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    searchQuestionBank<AssessmentQuestionBankItem>(query ? { q: query } : {})
      .then((result) => setItems(result.items))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load question bank')
      );
  }, [query]);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-black uppercase text-slate-500">Question bank</h2>
      <input
        aria-label="Search question bank"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        placeholder="Search questions"
      />
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      <div className="space-y-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-md border border-slate-200 p-3">
            <p className="text-sm font-bold text-slate-900">{item.prompt}</p>
            <p className="mt-1 text-xs text-slate-500">
              {item.skill} / {item.responseMode}
            </p>
            <button
              type="button"
              onClick={() => onInsert(item)}
              className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white"
            >
              Insert
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
