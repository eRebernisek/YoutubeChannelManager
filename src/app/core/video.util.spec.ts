import {
  moveChaptersToTop,
  parseDuration,
  parseTags,
  validateMetadata,
  videoKind,
  writableStatus,
} from './video.util';
import { Video } from './youtube.models';

describe('video.util', () => {
  it('parses ISO durations', () => {
    expect(parseDuration('PT1H2M3S')).toBe(3723);
    expect(parseDuration('PT59S')).toBe(59);
    expect(parseDuration('P1DT1S')).toBe(86401);
    expect(parseDuration(undefined)).toBe(0);
  });

  it('guesses the video kind', () => {
    const base = { id: 'x', snippet: { title: '', description: '', categoryId: '20' }, status: { privacyStatus: 'public' } } as Video;
    expect(videoKind({ ...base, contentDetails: { duration: 'PT45S' } })).toBe('Short');
    expect(videoKind({ ...base, contentDetails: { duration: 'PT10M' } })).toBe('Video');
    expect(videoKind({ ...base, contentDetails: { duration: 'PT45S' }, liveStreamingDetails: {} })).toBe('Live/VOD');
  });

  it('drops publishAt unless the video is private', () => {
    expect(writableStatus({ privacyStatus: 'public', publishAt: '2030-01-01T00:00:00Z' }).publishAt).toBeUndefined();
    expect(writableStatus({ privacyStatus: 'private', publishAt: '2030-01-01T00:00:00Z' }).publishAt).toBe('2030-01-01T00:00:00Z');
    expect(writableStatus({ privacyStatus: 'public', madeForKids: false }).selfDeclaredMadeForKids).toBe(false);
  });

  it('moves chapters to the top of the description', () => {
    const desc = 'Great set!\n\nLinks: x\n\n00:00 Intro\n01:23 - Pools\n1:02:03 Grand Finals\n\nThanks';
    expect(moveChaptersToTop(desc)).toBe(
      '00:00 Intro\n01:23 - Pools\n1:02:03 Grand Finals\n\nGreat set!\n\nLinks: x\n\nThanks',
    );
  });

  it('leaves descriptions with fewer than 3 chapters alone', () => {
    const desc = 'Hi\n00:00 Intro\n01:00 End';
    expect(moveChaptersToTop(desc)).toBe(desc);
  });

  it('validates YouTube limits', () => {
    expect(validateMetadata({ title: 'ok', description: 'ok', tags: ['a'] })).toEqual([]);
    expect(validateMetadata({ title: 'a<b', description: '', tags: [] })).toContain('Title cannot contain < or >.');
    expect(validateMetadata({ title: 'x'.repeat(101), description: '', tags: [] })[0]).toMatch(/max 100/);
    expect(validateMetadata({ title: 'x', description: 'é'.repeat(2501), tags: [] })[0]).toMatch(/5,000/);
    expect(validateMetadata({ title: 'x', description: '', tags: ['t'.repeat(501)] })[0]).toMatch(/max 500/);
  });

  it('parses tags', () => {
    expect(parseTags('rivals 2, #smash,\nfgc ,,')).toEqual(['rivals 2', 'smash', 'fgc']);
  });
});
