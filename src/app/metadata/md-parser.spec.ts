import { parseMetadata, parseYaml } from './md-parser';

const FENCE = '```';

describe('parseMetadata — front matter format', () => {
  const md = [
    '---',
    'title: "Rivals 2 Amateur Bracket — Top 8"',
    'tags: [rivals 2, "rivals of aether 2", smash]',
    'category: 20            # Gaming',
    'privacy: scheduled',
    'publishAt: 2026-11-15 18:00',
    'channel: "@ManyTheGuy"',
    'playlists:',
    '  - Rivals 2 Tournaments',
    '  - "Top 8s"',
    'madeForKids: false',
    'language: en',
    'thumbnail: thumb.jpg',
    '---',
    '',
    '## Description',
    FENCE,
    'Full description pasted as-is.',
    '# not a heading',
    '00:00 Intro',
    FENCE,
    '',
    '## Pinned comment',
    FENCE,
    'Thanks for watching!',
    FENCE,
  ].join('\n');

  it('reads every field', () => {
    const m = parseMetadata(md);
    expect(m).toEqual({
      title: 'Rivals 2 Amateur Bracket — Top 8',
      tags: ['rivals 2', 'rivals of aether 2', 'smash'],
      categoryId: '20',
      privacy: 'scheduled',
      publishAt: '2026-11-15 18:00',
      channel: '@ManyTheGuy',
      playlists: ['Rivals 2 Tournaments', 'Top 8s'],
      madeForKids: false,
      language: 'en',
      thumbnail: 'thumb.jpg',
      description: 'Full description pasted as-is.\n# not a heading\n00:00 Intro',
      pinnedComment: 'Thanks for watching!',
      warnings: [],
    });
  });

  it('handles Windows line endings', () => {
    expect(parseMetadata(md.replace(/\n/g, '\r\n')).title).toBe('Rivals 2 Amateur Bracket — Top 8');
  });

  it('accepts category names and implies scheduled from publishAt', () => {
    const m = parseMetadata('---\ncategory: Gaming\npublishAt: 2026-12-01T09:30\n---\n');
    expect(m.categoryId).toBe('20');
    expect(m.privacy).toBe('scheduled');
    expect(m.publishAt).toBe('2026-12-01 09:30');
  });

  it('warns about bad values instead of failing', () => {
    const m = parseMetadata('---\nprivacy: secret\ncategory: Cooking\nfoo: bar\npublishAt: tomorrow\n---\n');
    expect(m.privacy).toBeUndefined();
    expect(m.warnings).toHaveLength(4);
  });
});

describe('parseMetadata — legacy section format', () => {
  it('reads quoted title, description block, tags table and pinned comment', () => {
    const md = [
      '# Video 12',
      '## Title',
      'Some intro text',
      '> **DoomerTron explains the end of the world**',
      '',
      '## Description',
      FENCE + 'text',
      'Line 1',
      '',
      'Line 3',
      FENCE,
      '',
      '| Field | Value |',
      '|---|---|',
      '| **Tags** | `doomer, ai, shorts` |',
      '',
      '### Pinned comment',
      FENCE,
      'First!',
      FENCE,
    ].join('\n');
    expect(parseMetadata(md)).toEqual({
      title: 'DoomerTron explains the end of the world',
      description: 'Line 1\n\nLine 3',
      tags: ['doomer', 'ai', 'shorts'],
      pinnedComment: 'First!',
      warnings: [],
    });
  });

  it('reads a bold title and a fenced tags block', () => {
    const md = ['## Title', '**My Short**', '## Tags', FENCE, 'a, b,', 'c', FENCE].join('\n');
    const m = parseMetadata(md);
    expect(m.title).toBe('My Short');
    expect(m.tags).toEqual(['a', 'b', 'c']);
  });

  it('lets front matter override sections', () => {
    const md = ['---', 'title: From front matter', '---', '## Title', '> From section'].join('\n');
    expect(parseMetadata(md).title).toBe('From front matter');
  });

  it('warns when the description has no fenced block', () => {
    expect(parseMetadata('## Description\nplain text').warnings[0]).toContain('no fenced code block');
  });
});

describe('parseYaml', () => {
  it('keeps # inside quotes and strips trailing comments', () => {
    expect(parseYaml('a: "#1 video" # comment\nb: yes\nc: \'it\'\'s\'')).toEqual({ a: '#1 video', b: true, c: "it's" });
  });
});
