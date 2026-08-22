const dateDigitLimit = 8;
const timeDigitLimit = 6;

export const completeDisplayDatePattern = /^\d{2}\/\d{2}\/\d{4}$/;
export const completeDisplayTimePattern = /^\d{2}:\d{2}(?::\d{2})?$/;

function onlyDigits(value: string, limit: number) {
  return value.replace(/\D/g, '').slice(0, limit);
}

function maskDateDigits(digits: string) {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function maskTimeDigits(digits: string) {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}`;
}

function wasGeneratedDateMask(value: string) {
  return Boolean(value) && value === maskDateDigits(onlyDigits(value, dateDigitLimit));
}

function wasGeneratedTimeMask(value: string) {
  return Boolean(value) && value === maskTimeDigits(onlyDigits(value, timeDigitLimit));
}

export function applyDateInputMask(value: string, previousValue = '') {
  if (value.includes('/') && (value.endsWith('/') || !wasGeneratedDateMask(previousValue))) {
    return value.replace(/[^\d/]/g, '').slice(0, 10);
  }

  return maskDateDigits(onlyDigits(value, dateDigitLimit));
}

export function applyTimeInputMask(value: string, previousValue = '') {
  if (value.includes(':') && (value.endsWith(':') || !wasGeneratedTimeMask(previousValue))) {
    return value.replace(/[^\d:]/g, '').slice(0, 8);
  }

  return maskTimeDigits(onlyDigits(value, timeDigitLimit));
}

export function stripDefaultSeconds(value: string) {
  return value.endsWith(':00') ? value.slice(0, 5) : value;
}
