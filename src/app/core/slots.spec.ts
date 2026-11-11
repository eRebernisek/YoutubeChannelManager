import { nextFreeSlots } from './slots';

const sp = (s: string) => new Date(s + '-03:00');

describe('nextFreeSlots', () => {
  const slots = ['18:00', '00:00', '12:00'];

  it('returns the next slots in order, rolling over days', () => {
    const got = nextFreeSlots(slots, 4, sp('2026-11-15T13:00')).map((d) => d.toISOString());
    expect(got).toEqual([
      sp('2026-11-15T18:00').toISOString(),
      sp('2026-11-16T00:00').toISOString(),
      sp('2026-11-16T12:00').toISOString(),
      sp('2026-11-16T18:00').toISOString(),
    ]);
  });

  it('skips busy slots', () => {
    const got = nextFreeSlots(slots, 1, sp('2026-11-15T13:00'), [sp('2026-11-15T18:00')]);
    expect(got[0].toISOString()).toBe(sp('2026-11-16T00:00').toISOString());
  });

  it('handles no slots', () => {
    expect(nextFreeSlots([], 3)).toEqual([]);
  });
});
