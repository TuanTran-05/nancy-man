const API_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * PostgreSQL DATE values can be returned either as YYYY-MM-DD strings or as
 * JavaScript Date objects, depending on the installed pg type parser. A Date
 * represents local midnight, so toISOString().slice(0, 10) can move it to the
 * previous day on a Vietnam host. Keep all document-store date keys in the
 * application's YYYY-MM-DD contract.
 */
export function materializeDocumentDateOnly(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (API_DATE_ONLY.test(raw)) return raw;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return vietnamDateFormatter.format(value);
  }

  // pg/date parsers may also hand an ISO timestamp to a later materialization
  // pass. Only parse an explicit ISO timestamp; do not guess incomplete values
  // such as "Wed Jul 08", because they no longer contain a year.
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return vietnamDateFormatter.format(parsed);
  }

  return raw.slice(0, 10);
}
