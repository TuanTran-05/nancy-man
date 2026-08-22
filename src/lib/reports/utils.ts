import { apiDateToDisplayDate } from '../core/utils';

export const formatMonthRange = (month: string, language: string) => {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;

  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 0);
  const startIso = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
  const endIso = `${year}-${String(monthNumber).padStart(2, '0')}-${String(end.getDate()).padStart(
    2,
    '0'
  )}`;
  return `${apiDateToDisplayDate(startIso)} - ${apiDateToDisplayDate(endIso)}`;
};

export const exportCsv = (filename: string, rows: (string | number)[][]) => {
  const content =
    '\uFEFF' +
    rows
      .map((row) => row.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
