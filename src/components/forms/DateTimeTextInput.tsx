import { type ChangeEvent, useId, useRef, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import {
  apiDateToDisplayDate,
  normalizeUserDateInput,
  normalizeUserDateTimeInput,
  normalizeUserTimeInput,
  userDateToApiDate,
} from '../../lib/core/utils';
import { applyDateInputMask, applyTimeInputMask, stripDefaultSeconds } from './dateTimeInputMasks';

type DateTimeTextInputMode = 'date' | 'time' | 'datetime';

type DateTimeTextInputProps = {
  mode: DateTimeTextInputMode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

const ERROR_MESSAGES: Record<DateTimeTextInputMode, string> = {
  date: 'Ngay khong hop le. Dung dinh dang dd/mm/yyyy.',
  time: 'Gio khong hop le. Dung dinh dang hh:mm:ss.',
  datetime: 'Ngay gio khong hop le. Dung dinh dang hh:mm:ss dd/mm/yyyy.',
};

const PLACEHOLDERS: Record<DateTimeTextInputMode, string> = {
  date: 'dd/mm/yyyy',
  time: 'hh:mm:ss',
  datetime: 'hh:mm:ss dd/mm/yyyy',
};
const pickerButtonClass =
  'absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:pointer-events-none disabled:opacity-40';
const nativePickerClass = 'sr-only';

function normalizeValue(mode: DateTimeTextInputMode, value: string) {
  if (!value.trim()) return '';
  if (mode === 'date') return normalizeUserDateInput(value);
  if (mode === 'time') return normalizeUserTimeInput(value);
  return normalizeUserDateTimeInput(value);
}

function maskValue(mode: DateTimeTextInputMode, nextValue: string, previousValue: string) {
  if (mode === 'date') return applyDateInputMask(nextValue, previousValue);
  if (mode === 'time') return applyTimeInputMask(nextValue, previousValue);
  return nextValue;
}

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

function toNativeDateValue(value: string) {
  if (!value) return '';
  try {
    return userDateToApiDate(value);
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

function toNativeDateTimeValue(value: string) {
  if (!value) return '';
  try {
    const normalized = normalizeUserDateTimeInput(value);
    const [time, date] = normalized.split(' ');
    const [day, month, year] = date.split('/');
    return `${year}-${month}-${day}T${stripDefaultSeconds(time)}`;
  } catch {
    return '';
  }
}

function formatNativeDateTimeValue(value: string) {
  const [date, time] = value.split('T');
  if (!date || !time) throw new Error('Invalid datetime');
  return `${normalizeUserTimeInput(time)} ${apiDateToDisplayDate(date)}`;
}

export function DateTimeTextInput({
  mode,
  label,
  value,
  onChange,
  required,
  disabled,
  className,
}: DateTimeTextInputProps) {
  const id = useId();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const hasNativePicker = mode === 'date' || mode === 'time' || mode === 'datetime';

  const handleBlur = () => {
    try {
      const normalized = normalizeValue(mode, value);
      setError('');
      if (normalized !== value) onChange(normalized);
    } catch {
      setError(ERROR_MESSAGES[mode]);
    }
  };

  const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    if (!raw) return;

    if (mode === 'date') {
      onChange(apiDateToDisplayDate(raw));
      setError('');
      return;
    }

    if (mode === 'time') {
      try {
        onChange(stripDefaultSeconds(normalizeUserTimeInput(raw)));
        setError('');
      } catch {
        setError(ERROR_MESSAGES.time);
      }
      return;
    }

    if (mode === 'datetime') {
      try {
        onChange(formatNativeDateTimeValue(raw));
        setError('');
      } catch {
        setError(ERROR_MESSAGES.datetime);
      }
    }
  };

  return (
    <label className={className}>
      <span className="mb-1 block text-sm font-bold text-slate-700">{label}</span>
      <div className="relative">
        <input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          type="text"
          inputMode="numeric"
          placeholder={PLACEHOLDERS[mode]}
          value={value}
          required={required}
          disabled={disabled}
          onChange={(event) => {
            setError('');
            onChange(maskValue(mode, event.target.value, value));
          }}
          onBlur={handleBlur}
          className={`h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:opacity-60 ${hasNativePicker ? 'pr-11' : ''}`}
        />
        {hasNativePicker && (
          <>
            <button
              type="button"
              aria-label={
                mode === 'date'
                  ? 'Open calendar picker'
                  : mode === 'time'
                    ? 'Open time picker'
                    : 'Open date and time picker'
              }
              disabled={disabled}
              onClick={() => openNativePicker(pickerRef.current)}
              className={pickerButtonClass}
            >
              {mode === 'date' ? (
                <Calendar className="h-4 w-4" aria-hidden="true" />
              ) : mode === 'time' ? (
                <Clock className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Calendar className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <input
              ref={pickerRef}
              aria-label={
                mode === 'date'
                  ? 'Native calendar picker'
                  : mode === 'time'
                    ? 'Native time picker'
                    : 'Native date and time picker'
              }
              tabIndex={-1}
              type={mode === 'datetime' ? 'datetime-local' : mode}
              step={mode === 'time' || mode === 'datetime' ? 1 : undefined}
              value={
                mode === 'date'
                  ? toNativeDateValue(value)
                  : mode === 'time'
                    ? toNativeTimeValue(value)
                    : toNativeDateTimeValue(value)
              }
              disabled={disabled}
              onChange={handlePickerChange}
              className={nativePickerClass}
            />
          </>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      )}
    </label>
  );
}
