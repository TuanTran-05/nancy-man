import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/core/utils';

export interface AlignedDropdownOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface AlignedDropdownProps {
  value: string;
  options: readonly AlignedDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  align?: 'left' | 'right';
  placement?: 'bottom' | 'top';
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  leadingIcon?: React.ReactNode;
}

function nextEnabledIndex(
  options: readonly AlignedDropdownOption[],
  currentIndex: number,
  direction: 1 | -1
) {
  if (options.length === 0) return -1;

  const startIndex = currentIndex >= 0 ? currentIndex : direction === 1 ? -1 : 0;

  for (let step = 1; step <= options.length; step += 1) {
    const nextIndex = (startIndex + direction * step + options.length) % options.length;
    if (!options[nextIndex]?.disabled) return nextIndex;
  }

  return -1;
}

export function AlignedDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  align = 'left',
  placement = 'bottom',
  disabled = false,
  className,
  buttonClassName,
  menuClassName,
  leadingIcon,
}: AlignedDropdownProps) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({});

  const selectedIndex = options.findIndex((option) => option.value === value);
  const activeIndex =
    selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);
  const [keyboardIndex, setKeyboardIndex] = useState(activeIndex);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  useEffect(() => {
    if (open) setKeyboardIndex(activeIndex);
  }, [activeIndex, open]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 16;
    const gap = 4;
    const nextPosition: React.CSSProperties = {
      minWidth: rect.width,
      maxWidth: 'calc(100vw - 2rem)',
    };

    if (placement === 'top') {
      nextPosition.bottom = Math.max(window.innerHeight - rect.top + gap, viewportPadding);
    } else {
      nextPosition.top = Math.min(rect.bottom + gap, window.innerHeight - viewportPadding);
    }

    if (align === 'right') {
      nextPosition.right = Math.max(window.innerWidth - rect.right, viewportPadding);
    } else {
      nextPosition.left = Math.max(rect.left, viewportPadding);
    }

    setMenuPosition(nextPosition);
  }, [align, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const reposition = () => updateMenuPosition();

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, updateMenuPosition]);

  const selectOption = (option: AlignedDropdownOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setKeyboardIndex((current) => nextEnabledIndex(options, current, direction));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }

      const option = options[keyboardIndex];
      if (option) selectOption(option);
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && keyboardIndex >= 0 ? `${listboxId}-${keyboardIndex}` : undefined
        }
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-xl border border-border-default bg-surface px-3 py-2 text-left text-sm font-medium text-heading shadow-sm outline-none transition focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60',
          buttonClassName
        )}
      >
        {leadingIcon ? (
          <span aria-hidden="true" className="pointer-events-none shrink-0">
            {leadingIcon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-left">{selectedOption?.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-4 w-4 shrink-0 text-slate-400 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              style={menuPosition}
              className={cn(
                'fixed z-[1000] max-h-80 w-max max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-left text-sm shadow-xl',
                menuClassName
              )}
            >
              {options.map((option, index) => {
                const selected = option.value === value;
                const active = index === keyboardIndex;

                return (
                  <button
                    key={option.value}
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={option.disabled}
                    onClick={() => selectOption(option)}
                    className={cn(
                      'block w-full px-4 py-2.5 text-left text-sm text-slate-700 transition focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400',
                      active && 'bg-blue-50 text-blue-700',
                      selected && 'bg-blue-600 text-white hover:bg-blue-600 focus:bg-blue-600',
                      !selected &&
                        'hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700'
                    )}
                  >
                    <span className="block truncate text-left">{option.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
