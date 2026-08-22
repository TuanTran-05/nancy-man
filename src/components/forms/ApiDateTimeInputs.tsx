import {
  type ChangeEvent,
  type InputHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Calendar, Clock } from 'lucide-react';
import {
  apiDateToDisplayDate,
  apiTimeToDisplayTime,
  cn,
  normalizeDateLikeToApiDate,
  normalizeUserDateInput,
  normalizeUserTimeInput,
} from '../../lib/core/utils';
import {
  applyDateInputMask,
  applyTimeInputMask,
  completeDisplayDatePattern,
  completeDisplayTimePattern,
  stripDefaultSeconds,
} from './dateTimeInputMasks';

type ApiInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hideLabel?: boolean;
  inputClassName?: string;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:opacity-60';
const apiDateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const apiTimeOnlyPattern = /^\d{2}:\d{2}:\d{2}$/;
const pickerButtonClass =
  'absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:pointer-events-none disabled:opacity-40';
const nativePickerClass = 'sr-only';

function openNativePicker(input: HTMLInputElement | null) {
  if (!input) return;
  try {
    input.showPicker?.();
    return;
  } catch {
    input.focus();
    input.click();
  }
}

function displayApiDate(value: string): string {
  if (!value) return '';
  try {
    return apiDateToDisplayDate(value);
  } catch {
    try {
      return normalizeUserDateInput(value);
    } catch {
      return value;
    }
  }
}

function displayApiTime(value: string): string {
  if (!value) return '';
  try {
    return stripDefaultSeconds(apiTimeToDisplayTime(value));
  } catch {
    try {
      return stripDefaultSeconds(normalizeUserTimeInput(value));
    } catch {
      return value;
    }
  }
}

function toNativeDateValue(value: string) {
  if (!value) return '';
  try {
    return normalizeDateLikeToApiDate(value);
  } catch {
    return '';
  }
}

function toNativeTimeValue(value: string) {
  if (!value) return '';
  try {
    return stripDefaultSeconds(normalizeUserTimeInput(value));
  } catch {
    return '';
  }
}

export function ApiDateTextInput({
  label,
  value,
  onChange,
  hideLabel,
  className,
  inputClassName,
  id,
  ...inputProps
}: ApiInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const pickerRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => displayApiDate(value));
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(displayApiDate(value));
    setError('');
  }, [value]);

  const handleBlur = () => {
    const raw = draft.trim();
    if (!raw) {
      setError('');
      setDraft('');
      if (value) onChange('');
      return;
    }

    try {
      const canonical = normalizeDateLikeToApiDate(raw);
      setDraft(apiDateToDisplayDate(canonical));
      setError('');
      if (canonical !== value) onChange(canonical);
    } catch {
      setError('Ngay khong hop le. Dung dinh dang dd/mm/yyyy.');
    }
  };

  const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const canonical = event.target.value;
    if (!canonical) return;
    setDraft(apiDateToDisplayDate(canonical));
    setError('');
    if (canonical !== value) onChange(canonical);
  };

  return (
    <label className={className} htmlFor={inputId}>
      <span className={cn('mb-1 block text-sm font-bold text-slate-700', hideLabel && 'sr-only')}>
        {label}
      </span>
      <div className="relative">
        <input
          {...inputProps}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : inputProps['aria-describedby']}
          type="text"
          inputMode="numeric"
          placeholder={inputProps.placeholder || 'dd/mm/yyyy'}
          value={draft}
          onChange={(event) => {
            const rawValue = event.target.value.trim();
            if (apiDateOnlyPattern.test(rawValue)) {
              try {
                const canonical = normalizeDateLikeToApiDate(rawValue);
                setDraft(apiDateToDisplayDate(canonical));
                setError('');
                if (canonical !== value) onChange(canonical);
              } catch {
                setError('');
                setDraft(event.target.value);
              }
              return;
            }

            const nextDraft = applyDateInputMask(event.target.value, draft);
            setError('');
            setDraft(nextDraft);
            if (!nextDraft.trim()) {
              if (value) onChange('');
              return;
            }
            const trimmedDraft = nextDraft.trim();
            if (
              !apiDateOnlyPattern.test(trimmedDraft) &&
              !completeDisplayDatePattern.test(trimmedDraft)
            ) {
              return;
            }
            try {
              const canonical = normalizeDateLikeToApiDate(nextDraft);
              if (canonical !== value) onChange(canonical);
            } catch {
              // Keep partial drafts local until blur can show a validation message.
            }
          }}
          onBlur={(event) => {
            inputProps.onBlur?.(event);
            handleBlur();
          }}
          className={cn(inputClass, inputClassName, 'pr-11')}
        />
        <button
          type="button"
          aria-label="Open calendar picker"
          disabled={inputProps.disabled}
          onClick={() => openNativePicker(pickerRef.current)}
          className={pickerButtonClass}
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          ref={pickerRef}
          aria-label="Native calendar picker"
          tabIndex={-1}
          type="date"
          value={toNativeDateValue(value)}
          disabled={inputProps.disabled}
          onChange={handlePickerChange}
          className={nativePickerClass}
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      )}
    </label>
  );
}

export function ApiTimeTextInput({
  label,
  value,
  onChange,
  hideLabel,
  className,
  inputClassName,
  id,
  ...inputProps
}: ApiInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const pickerRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => displayApiTime(value));
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(displayApiTime(value));
    setError('');
  }, [value]);

  const handleBlur = () => {
    const raw = draft.trim();
    if (!raw) {
      setError('');
      setDraft('');
      if (value) onChange('');
      return;
    }

    try {
      const canonical = normalizeUserTimeInput(raw);
      setDraft(stripDefaultSeconds(canonical));
      setError('');
      if (canonical !== value) onChange(canonical);
    } catch {
      setError('Gio khong hop le. Dung dinh dang hh:mm:ss.');
    }
  };

  const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    if (!raw) return;
    try {
      const canonical = normalizeUserTimeInput(raw);
      setDraft(stripDefaultSeconds(canonical));
      setError('');
      if (canonical !== value) onChange(canonical);
    } catch {
      setError('Gio khong hop le. Dung dinh dang hh:mm:ss.');
    }
  };

  return (
    <label className={className} htmlFor={inputId}>
      <span className={cn('mb-1 block text-sm font-bold text-slate-700', hideLabel && 'sr-only')}>
        {label}
      </span>
      <div className="relative">
        <input
          {...inputProps}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : inputProps['aria-describedby']}
          type="text"
          inputMode="numeric"
          placeholder={inputProps.placeholder || 'hh:mm'}
          value={draft}
          onChange={(event) => {
            const nextDraft = applyTimeInputMask(event.target.value, draft);
            setError('');
            setDraft(nextDraft);
            if (!nextDraft.trim()) {
              if (value) onChange('');
              return;
            }
            const trimmedDraft = nextDraft.trim();
            if (
              !apiTimeOnlyPattern.test(trimmedDraft) &&
              !completeDisplayTimePattern.test(trimmedDraft)
            ) {
              return;
            }
            try {
              const canonical = normalizeUserTimeInput(nextDraft);
              if (canonical !== value) onChange(canonical);
            } catch {
              // Keep partial drafts local until blur can show a validation message.
            }
          }}
          onBlur={(event) => {
            inputProps.onBlur?.(event);
            handleBlur();
          }}
          className={cn(inputClass, inputClassName, 'pr-11')}
        />
        <button
          type="button"
          aria-label="Open time picker"
          disabled={inputProps.disabled}
          onClick={() => openNativePicker(pickerRef.current)}
          className={pickerButtonClass}
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          ref={pickerRef}
          aria-label="Native time picker"
          tabIndex={-1}
          type="time"
          step={inputProps.step ?? 1}
          value={toNativeTimeValue(value)}
          disabled={inputProps.disabled}
          onChange={handlePickerChange}
          className={nativePickerClass}
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      )}
    </label>
  );
}
