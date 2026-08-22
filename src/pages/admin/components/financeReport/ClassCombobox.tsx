import React, { useId, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

export type ClassComboboxOption = {
  id: string;
  /** What the box and the option row show once the class is picked. */
  label: string;
  /** Everything the query is matched against — class name and teacher name. */
  searchText: string;
};

export type ClassComboboxProps = {
  options: readonly ClassComboboxOption[];
  value: string;
  onChange: (classId: string) => void;
  label: string;
  placeholder: string;
  emptyText: string;
  clearLabel: string;
  disabled?: boolean;
};

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('vi');
}

/**
 * A search box and a class picker in one control: focusing it opens the whole class
 * list, typing narrows it live, and the box falls back to showing the picked class
 * once it closes. Typing never touches the selection — only picking a row or the
 * clear button does — so a half-typed query cannot silently refetch the report.
 */
export function ClassCombobox({
  options,
  value,
  onChange,
  label,
  placeholder,
  emptyText,
  clearLabel,
  disabled = false,
}: ClassComboboxProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const listboxId = `${id}-listbox`;

  // `null` means "not searching": the box shows the selected class, not a query.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value]
  );

  const matches = useMemo(() => {
    const normalized = normalizeSearch((query ?? '').trim());
    if (!normalized) return options;
    return options.filter((option) => normalizeSearch(option.searchText).includes(normalized));
  }, [options, query]);

  const openPanel = () => {
    if (open) return;
    setOpen(true);
    setQuery('');
    setActiveIndex(0);
  };

  const closePanel = () => {
    setOpen(false);
    setQuery(null);
    setActiveIndex(0);
  };

  const select = (classId: string) => {
    onChange(classId);
    closePanel();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openPanel();
        return;
      }
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + step + matches.length) % matches.length);
      return;
    }

    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = matches[activeIndex];
      if (option) select(option.id);
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closePanel();
    }
  };

  // Focus leaving the whole control closes it; focus moving to the clear button or an
  // option row stays inside and must not.
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    closePanel();
  };

  return (
    <div className="relative flex flex-col" onBlur={handleBlur}>
      <label htmlFor={inputId} className="text-xs font-semibold text-slate-500">
        {label}
      </label>

      <div className="relative mt-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && matches[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
          }
          disabled={disabled}
          value={query ?? selected?.label ?? ''}
          placeholder={open && selected ? selected.label : placeholder}
          onFocus={openPanel}
          onClick={openPanel}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className="h-11 w-full rounded-xl border border-border-default bg-surface pr-10 pl-9 text-sm font-semibold text-heading outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
        />
        {value && !disabled && (
          <button
            type="button"
            title={clearLabel}
            aria-label={clearLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              closePanel();
            }}
            className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {open &&
        (matches.length === 0 ? (
          <div className="absolute top-full right-0 left-0 z-20 mt-1 rounded-xl border border-border-default bg-surface p-3 text-sm text-subtle shadow-lg">
            {emptyText}
          </div>
        ) : (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            // Keeps focus in the input so the panel does not blur itself shut mid-click.
            onMouseDown={(event) => event.preventDefault()}
            className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-border-default bg-surface py-1 text-sm shadow-lg"
          >
            {matches.map((option, index) => (
              <li
                key={option.id}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={option.id === value}
                data-testid={`class-option:${option.id}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(option.id)}
                className={`cursor-pointer truncate px-3 py-2 font-semibold ${
                  index === activeIndex ? 'bg-blue-50 text-blue-700' : 'text-heading'
                } ${option.id === value ? 'ring-1 ring-blue-200 ring-inset' : ''}`}
              >
                {option.label}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
