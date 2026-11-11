/** Time helpers. Schedules are picked in São Paulo time and sent to YouTube as UTC. */

export const APP_TZ = 'America/Sao_Paulo';
/** YouTube's daily quota resets at midnight Pacific Time. */
export const QUOTA_TZ = 'America/Los_Angeles';

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(date)) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return {
    year: p['year'],
    month: p['month'],
    day: p['day'],
    hour: p['hour'],
    minute: p['minute'],
    second: p['second'],
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (São Paulo → -180). */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * "2026-11-15 18:00" or "2026-11-15T18:00" (wall time in `timeZone`) → Date.
 * Returns null when the text isn't a valid date-time.
 */
export function zonedToDate(local: string, timeZone = APP_TZ): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes handle a DST change between the guess and the real instant.
  let ts = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  ts = guess - offsetMinutes(new Date(ts), timeZone) * 60000;
  const result = new Date(ts);
  const back = partsIn(result, timeZone);
  if (back.year !== y || back.month !== mo || back.day !== d || back.hour !== h) return null;
  return result;
}

/** Date → "YYYY-MM-DDTHH:mm" wall time in `timeZone` (value for <input type="datetime-local">). */
export function dateToZoned(date: Date, timeZone = APP_TZ): string {
  const p = partsIn(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Human-readable São Paulo time, e.g. "15 Nov 2026, 18:00". */
export function formatSaoPaulo(date: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(typeof date === 'string' ? new Date(date) : date);
}

/** "YYYY-MM-DD" of the current YouTube quota day (Pacific Time). */
export function quotaDay(now = new Date()): string {
  const p = partsIn(now, QUOTA_TZ);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** When the current quota day ends (next Pacific midnight). */
export function nextQuotaReset(now = new Date()): Date {
  const p = partsIn(now, QUOTA_TZ);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const iso = tomorrow.toISOString().slice(0, 10);
  return zonedToDate(`${iso} 00:00`, QUOTA_TZ)!;
}
