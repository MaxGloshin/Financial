export const MS_DAY = 86_400_000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return localDateKey(new Date());
}

export function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDateKey(value).getTime());
}

export function parseDateKey(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function dateKeyToIsoNoon(value: string): string {
  return parseDateKey(value).toISOString();
}

export function monthKey(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthKey(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Некорректный месяц');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error('Некорректный месяц');
  return { year, monthIndex };
}

export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parseMonthKey(month);
  const d = new Date(year, monthIndex + delta, 1, 12);
  return monthKey(d);
}

export function monthRange(month: string): { from: Date; to: Date; fromIso: string; toIso: string } {
  const { year, monthIndex } = parseMonthKey(month);
  const from = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const to = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
  return { from, to, fromIso: from.toISOString(), toIso: to.toISOString() };
}

export function daysInMonth(month: string): number {
  const { year, monthIndex } = parseMonthKey(month);
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function formatMonth(month: string, options: { year?: boolean } = {}): string {
  const { year, monthIndex } = parseMonthKey(month);
  const text = new Date(year, monthIndex, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    ...(options.year === false ? {} : { year: 'numeric' }),
  });
  return text.replace(' г.', '');
}

export function formatMonthShort(month: string): string {
  const { year, monthIndex } = parseMonthKey(month);
  return new Date(year, monthIndex, 1).toLocaleDateString('ru-RU', { month: 'short' });
}

export function formatDate(isoOrKey: string, withYear = false): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoOrKey) ? parseDateKey(isoOrKey) : new Date(isoOrKey);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function formatDateShort(isoOrKey: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoOrKey) ? parseDateKey(isoOrKey) : new Date(isoOrKey);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function formatWeekday(isoOrKey: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoOrKey) ? parseDateKey(isoOrKey) : new Date(isoOrKey);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { weekday: 'short' });
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso, true)}, ${formatTime(iso)}`;
}

export function addDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function daysBetween(fromKey: string, toKey: string): number {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  return Math.round((to.getTime() - from.getTime()) / MS_DAY);
}

export function daysUntil(dateKey: string, fromKey = todayKey()): number {
  return daysBetween(fromKey, dateKey);
}

export function clampDayToMonth(day: number, month: string): number {
  return Math.min(Math.max(1, day), daysInMonth(month));
}

/** Next occurrence of a monthly payment day, including today. */
export function nextOccurrenceOfDay(dayOfMonth: number, fromKey = todayKey()): string {
  const from = parseDateKey(fromKey);
  const currentMonth = monthKey(from);
  const candidateDay = clampDayToMonth(dayOfMonth, currentMonth);
  const candidate = `${currentMonth}-${String(candidateDay).padStart(2, '0')}`;
  if (candidate >= fromKey) return candidate;
  const nextMonth = shiftMonth(currentMonth, 1);
  const nextDay = clampDayToMonth(dayOfMonth, nextMonth);
  return `${nextMonth}-${String(nextDay).padStart(2, '0')}`;
}

export function daysElapsedInMonth(now = new Date()): number {
  const month = monthKey(now);
  return Math.min(now.getDate(), daysInMonth(month));
}

export function daysRemainingInMonth(now = new Date()): number {
  const total = daysInMonth(monthKey(now));
  return Math.max(0, total - now.getDate());
}

/** Format for <input type="datetime-local"> in local time. */
export function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nowIso();
  return date.toISOString();
}

export function toDateValue(isoOrKey: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrKey)) return isoOrKey;
  const date = new Date(isoOrKey);
  if (Number.isNaN(date.getTime())) return '';
  return localDateKey(date);
}

export function startOfWeekMonday(dateKey: string): string {
  const date = parseDateKey(dateKey);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return localDateKey(date);
}

export function relativeDayLabel(dateKey: string, today = todayKey()): string {
  const diff = daysBetween(today, dateKey);
  if (diff === 0) return 'Сегодня';
  if (diff === -1) return 'Вчера';
  if (diff === 1) return 'Завтра';
  return formatDate(dateKey);
}
