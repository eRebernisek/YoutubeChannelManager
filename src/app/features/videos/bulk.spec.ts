import { Video } from '../../core/youtube.models';
import { EMPTY_OPS, computeBulkChange } from './bulk';

const video = (over: Partial<Video['snippet']> = {}, status: Partial<Video['status']> = {}): Video => ({
  id: 'v1',
  snippet: { title: 'Rivals 2 Top 8', description: 'Bracket: old.link', categoryId: '20', tags: ['rivals 2', 'fgc'], ...over },
  status: { privacyStatus: 'public', ...status },
});

describe('computeBulkChange', () => {
  it('changes nothing with empty ops', () => {
    const c = computeBulkChange(video(), EMPTY_OPS);
    expect(c.snippet).toBeUndefined();
    expect(c.status).toBeUndefined();
    expect(c.summary).toEqual([]);
  });

  it('keeps the full snippet when only tags change', () => {
    const c = computeBulkChange(video(), { ...EMPTY_OPS, addTags: ['Smash', 'FGC'], removeTags: ['rivals 2'] });
    expect(c.snippet).toEqual({
      title: 'Rivals 2 Top 8',
      description: 'Bracket: old.link',
      categoryId: '20',
      tags: ['fgc', 'Smash'],
    });
    expect(c.summary).toEqual(['tags +1', 'tags −1']);
  });

  it('finds and replaces, and appends once', () => {
    const ops = { ...EMPTY_OPS, find: 'old.link', replace: 'new.link', appendDescription: '#rivals2' };
    const c = computeBulkChange(video(), ops);
    expect(c.snippet!.description).toBe('Bracket: new.link\n\n#rivals2');
    const again = computeBulkChange({ ...video(), snippet: { ...video().snippet, ...c.snippet! } }, ops);
    expect(again.snippet).toBeUndefined();
  });

  it('drops the schedule when making a scheduled video public', () => {
    const c = computeBulkChange(video({}, ), { ...EMPTY_OPS, privacy: 'unlisted' });
    expect(c.status).toEqual({ privacyStatus: 'unlisted' });
    const s = computeBulkChange(video({}, { privacyStatus: 'private', publishAt: '2030-01-01T00:00:00Z' }), {
      ...EMPTY_OPS,
      privacy: 'public',
    });
    expect(s.status!.publishAt).toBeUndefined();
    expect(s.summary[0]).toContain('removes schedule');
  });
});
