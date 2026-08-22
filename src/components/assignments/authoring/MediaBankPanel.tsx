import { useEffect, useState } from 'react';
import type { AssessmentMediaBankItem } from '../../../../shared/assignmentAuthoring';
import { searchMediaBank } from '../../../lib/api/assignmentAuthoringApi';

interface MediaBankPanelProps {
  onInsert: (item: AssessmentMediaBankItem) => void;
}

export function MediaBankPanel({ onInsert }: MediaBankPanelProps) {
  const [items, setItems] = useState<AssessmentMediaBankItem[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    searchMediaBank<AssessmentMediaBankItem>(query ? { q: query } : {})
      .then((result) => setItems(result.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load media bank'));
  }, [query]);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-black uppercase text-slate-500">Media bank</h2>
      <input
        aria-label="Search media bank"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        placeholder="Search media"
      />
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No saved media yet.</p>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onInsert(item)}
            className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm"
          >
            {item.title || item.url}
          </button>
        ))
      )}
    </div>
  );
}
