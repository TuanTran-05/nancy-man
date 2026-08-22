import { X } from 'lucide-react';
import type { AssessmentQuestionBankItem } from '../../../../shared/assignmentAuthoring';
import { QuestionBankPanel } from './QuestionBankPanel';

interface QuestionBankDrawerProps {
  open: boolean;
  onClose: () => void;
  onInsert: (item: AssessmentQuestionBankItem) => void;
}

export function QuestionBankDrawer({ open, onClose, onInsert }: QuestionBankDrawerProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/30">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Question bank"
        className="ml-auto h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">Question bank</h2>
          <button
            type="button"
            aria-label="Close question bank"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <QuestionBankPanel onInsert={onInsert} />
      </aside>
    </div>
  );
}
