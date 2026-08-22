import { LayoutTemplate } from 'lucide-react';
import { getStructureTemplates } from '../../../../shared/assignmentAuthoring';

interface TemplatePickerProps {
  onSelect: (templateId: string) => void;
}

export function TemplatePicker({ onSelect }: TemplatePickerProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-black uppercase text-slate-500">
        <LayoutTemplate className="h-4 w-4" />
        Templates
      </div>
      {getStructureTemplates().map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onSelect(template.id)}
          className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50"
        >
          <span className="block text-sm font-bold text-slate-900">{template.title}</span>
          <span className="block text-xs text-slate-500">{template.description}</span>
        </button>
      ))}
    </div>
  );
}
