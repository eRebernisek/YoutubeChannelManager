import {
  moveChaptersToTop,
  parseDuration,
  parseTags,
  systemPlaylistId,
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

  it("classifies videos with the channel's Shorts and lives playlists", () => {
    const base = {
      id: 'x',
      snippet: { title: '', description: '', categoryId: '20' },
      status: { privacyStatus: 'public' },
      contentDetails: { duration: 'PT45S' },
    } as Video;
    const kinds = { shorts: new Set(['x']), lives: new Set(['live']) };
    expect(videoKind(base, kinds)).toBe('Short');
    expect(videoKind({ ...base, id: 'other' }, kinds)).toBe('Video');
    expect(videoKind({ ...base, id: 'live' }, kinds)).toBe('Live/VOD');
    expect(videoKind({ ...base, liveStreamingDetails: {} }, kinds)).toBe('Live/VOD');
    // Without the sets, short duration alone doesn't make a Short.
    expect(videoKind(base)).toBe('Video');
    expect(videoKind({ ...base, liveStreamingDetails: {} }, null)).toBe('Live/VOD');
  });

  it('treats non-public #shorts uploads as Shorts', () => {
    const tagged = {
      id: 'p',
      snippet: { title: 'Combo #Shorts', description: '', categoryId: '20' },
      status: { privacyStatus: 'private' },
    } as Video;
    const empty = { shorts: new Set<string>(), lives: new Set<string>() };
    expect(videoKind(tagged, empty)).toBe('Short');
    expect(videoKind({ ...tagged, status: { privacyStatus: 'public' } }, empty)).toBe('Video');
  });

  it("derives the channel's system playlist IDs", () => {
    expect(systemPlaylistId('UCRoE-dG8Ds_yh0Nzvds6Iuw', 'UUSH')).toBe('UUSHRoE-dG8Ds_yh0Nzvds6Iuw');
    expect(systemPlaylistId('UCRoE-dG8Ds_yh0Nzvds6Iuw', 'UULV')).toBe('UULVRoE-dG8Ds_yh0Nzvds6Iuw');
    expect(systemPlaylistId('HCxyz', 'UUSH')).toBeNull();
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
