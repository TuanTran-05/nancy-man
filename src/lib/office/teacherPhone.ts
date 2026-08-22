export function formatTeacherPhone(phone?: string) {
  const trimmed = (phone || '').trim();
  const phoneWithoutPlus = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;

  if (/^84\d+$/.test(phoneWithoutPlus)) {
    return `0${phoneWithoutPlus.slice(2)}`;
  }

  return trimmed;
}

export function teacherPhoneSearchText(phone?: string) {
  const trimmed = (phone || '').trim();
  const displayPhone = formatTeacherPhone(trimmed);
  return displayPhone && displayPhone !== trimmed ? `${trimmed} ${displayPhone}` : trimmed;
}
