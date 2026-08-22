/**
 * Formats Vietnamese dong as a whole-number amount.
 *
 * PostgreSQL NUMERIC values can reach the frontend as decimal strings such as
 * `"250000.00"`. Calling `toLocaleString` on that string returns it unchanged,
 * so normalize to a finite number before applying Vietnamese separators.
 */
export function formatVndAmount(value: unknown): string {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })
    : '0';
}
