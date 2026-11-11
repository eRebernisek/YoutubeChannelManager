import { APP_TZ, dateToZoned, zonedToDate } from './time.util';

/**
 * Next publish slots after `after`, skipping slots in `busy` (spec §3, #/shorts-batch).
 * `slots` are "HH:mm" wall times in São Paulo. Busy times match when within 1 minute.
 */
export function nextFreeSlots(
  slots: string[],
  count: number,
  after: Date = new Date(),
  busy: Date[] = [],
  timeZone = APP_TZ,
): Date[] {
  const valid = [...new Set(slots.filter((s) => /^\d{2}:\d{2}$/.test(s)))].sort();
  if (!valid.length || count <= 0) return [];
  const taken = busy.map((d) => d.getTime());
  const isBusy = (t: number) => taken.some((b) => Math.abs(b - t) < 60_000);
  const out: Date[] = [];
  let day = dateToZoned(after, timeZone).slice(0, 10);
  for (let guard = 0; out.length < count && guard < 3660; guard++) {
    for (const slot of valid) {
      const at = zonedToDate(`${day} ${slot}`, timeZone);
      if (!at || at.getTime() <= after.getTime() || isBusy(at.getTime())) continue;
      out.push(at);
      taken.push(at.getTime());
      if (out.length === count) break;
    }
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    day = d.toISOString().slice(0, 10);
  }
  return out;
}
