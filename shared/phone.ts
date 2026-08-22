export function normalizePhoneVN(phone: string): string {
  let cleaned = phone.trim().replace(/[\s.\-()]/g, '');
  if (!cleaned) return '';

  if (cleaned.startsWith('+84')) {
    cleaned = cleaned.substring(1);
  } else if (cleaned.startsWith('0')) {
    cleaned = `84${cleaned.substring(1)}`;
  } else if (!cleaned.startsWith('84')) {
    cleaned = `84${cleaned}`;
  }

  return cleaned;
}

export function isValidVNPhone(phone: string): boolean {
  const cleaned = phone.trim().replace(/[\s.\-()]/g, '');
  return /^(\+?84|0)\d{9}$/.test(cleaned);
}
