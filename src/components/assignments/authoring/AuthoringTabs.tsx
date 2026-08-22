import type { AuthoringActiveTab } from './authoringUiState';

interface AuthoringTabsProps {
  activeTab: AuthoringActiveTab;
  onChange: (tab: AuthoringActiveTab) => void;
}

const tabs: Array<{ id: AuthoringActiveTab; label: string }> = [
  { id: 'questions', label: 'Questions' },
  { id: 'responses', label: 'Responses' },
  { id: 'settings', label: 'Settings' },
];

export function AuthoringTabs({ activeTab, onChange }: AuthoringTabsProps) {
  return (
    <nav className="border-b border-indigo-100 bg-white" aria-label="Assignment builder navigation">
      <div
        role="tablist"
        aria-label="Assignment builder sections"
        className="mx-auto flex max-w-3xl justify-center gap-2 px-3"
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`authoring-${tab.id}-panel`}
              onClick={() => onChange(tab.id)}
              className={`border-b-2 px-4 py-3 text-sm font-black transition ${
                selected
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
