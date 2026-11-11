import { dateToZoned, nextQuotaReset, quotaDay, zonedToDate } from './time.util';

describe('time.util', () => {
  it('converts São Paulo wall time to UTC', () => {
    expect(zonedToDate('2026-11-15 18:00')!.toISOString()).toBe('2026-11-15T21:00:00.000Z');
    expect(zonedToDate('2026-11-15T00:00')!.toISOString()).toBe('2026-11-15T03:00:00.000Z');
  });

  it('round-trips through datetime-local values', () => {
    const d = zonedToDate('2026-01-31 23:45')!;
    expect(dateToZoned(d)).toBe('2026-01-31T23:45');
  });

  it('rejects invalid input', () => {
    expect(zonedToDate('tomorrow')).toBeNull();
    expect(zonedToDate('2026-02-30 10:00')).toBeNull();
  });

  it('uses Pacific Time for the quota day', () => {
    // 05:00 UTC on Nov 11 is still Nov 10 in Los Angeles (UTC-8).
    expect(quotaDay(new Date('2026-11-11T05:00:00Z'))).toBe('2026-11-10');
    expect(nextQuotaReset(new Date('2026-11-11T05:00:00Z')).toISOString()).toBe('2026-11-11T08:00:00.000Z');
    // Summer: UTC-7.
    expect(nextQuotaReset(new Date('2026-07-01T12:00:00Z')).toISOString()).toBe('2026-07-02T07:00:00.000Z');
  });
});
