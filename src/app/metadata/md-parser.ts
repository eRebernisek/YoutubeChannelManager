/**
 * Parses a video metadata `.md` file (spec §3.1). Two formats are accepted:
 *
 * A. YAML front matter (`---` block with title, tags, privacy, publishAt…) plus `## Description` and
 *    `## Pinned comment` sections holding fenced code blocks.
 * B. Legacy sections: `## Title` (first `> quote` or `**bold**` line), `## Description` (first fenced
 *    block), tags from a `| Tags | … |` table row or a fenced comma-separated block, and an optional
 *    "Pinned comment" fenced block.
 *
 * Front matter values win over section values when both exist.
 */

import { PrivacyStatus } from '../core/youtube.models';

export type PrivacyChoice = PrivacyStatus | 'scheduled';

export interface VideoMetadata {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacy?: PrivacyChoice;
  /** Wall time in São Paulo, "YYYY-MM-DD HH:mm" (converted to UTC at upload). */
  publishAt?: string;
  playlists?: string[];
  madeForKids?: boolean;
  language?: string;
  thumbnail?: string;
  channel?: string;
  pinnedComment?: string;
  /** Problems found while parsing (unknown keys, bad values). Shown to the user, not fatal. */
  warnings: string[];
}

/** Category names accepted instead of IDs. */
const CATEGORY_NAMES: Record<string, string> = {
  'film & animation': '1',
  'autos & vehicles': '2',
  music: '10',
  'pets & animals': '15',
  sports: '17',
  'travel & events': '19',
  gaming: '20',
  'people & blogs': '22',
  comedy: '23',
  entertainment: '24',
  'news & politics': '25',
  'howto & style': '26',
  education: '27',
  'science & technology': '28',
  'nonprofits & activism': '29',
};

type YamlValue = string | boolean | number | string[];

export function parseMetadata(markdown: string): VideoMetadata {
  const text = markdown.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const warnings: string[] = [];
  const { front, body } = splitFrontMatter(text);
  const sections = splitSections(body);
  const meta: VideoMetadata = { warnings };

  // ---- legacy sections (B) -----------------------------------------------------------------------
  const titleSection = findSection(sections, (n) => n === 'title');
  if (titleSection) {
    const line = titleSection.find((l) => /^\s*>/.test(l) || /\*\*.+\*\*/.test(l));
    if (line) meta.title = stripInline(line);
  }
  const descSection = findSection(sections, (n) => n === 'description');
  if (descSection) {
    const block = firstFence(descSection);
    if (block != null) meta.description = block;
    else warnings.push('The "Description" section has no fenced code block, so it was ignored.');
  }
  const tags = tagsFromTable(body) ?? tagsFromSection(findSection(sections, (n) => n === 'tags'));
  if (tags) meta.tags = tags;
  const pinned = findSection(sections, (n) => n.includes('pinned comment'));
  if (pinned) {
    const block = firstFence(pinned);
    if (block != null && block.trim()) meta.pinnedComment = block;
  }

  // ---- front matter (A) --------------------------------------------------------------------------
  if (front) applyFrontMatter(meta, parseYaml(front, warnings));

  if (meta.publishAt && !meta.privacy) meta.privacy = 'scheduled';
  return meta;
}

function applyFrontMatter(meta: VideoMetadata, y: Record<string, YamlValue>): void {
  const w = meta.warnings;
  const str = (v: YamlValue) => (Array.isArray(v) ? v.join(', ') : String(v));
  for (const [rawKey, value] of Object.entries(y)) {
    const key = rawKey.toLowerCase().replace(/[_-]/g, '');
    switch (key) {
      case 'title':
        meta.title = str(value);
        break;
      case 'description':
        meta.description = str(value);
        break;
      case 'tags':
        meta.tags = Array.isArray(value) ? value : splitList(str(value));
        break;
      case 'category':
      case 'categoryid': {
        const v = str(value).trim();
        const id = /^\d+$/.test(v) ? v : CATEGORY_NAMES[v.toLowerCase()];
        if (id) meta.categoryId = id;
        else w.push(`Unknown category "${v}". Use a number (20 = Gaming) or a YouTube category name.`);
        break;
      }
      case 'privacy':
      case 'visibility': {
        const v = str(value).toLowerCase();
        if (['public', 'unlisted', 'private', 'scheduled'].includes(v)) meta.privacy = v as PrivacyChoice;
        else w.push(`Unknown privacy "${v}". Use public, unlisted, private or scheduled.`);
        break;
      }
      case 'publishat':
      case 'schedule': {
        const v = str(value).trim().replace('T', ' ');
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) meta.publishAt = v.slice(0, 16);
        else w.push(`publishAt "${v}" isn't "YYYY-MM-DD HH:mm".`);
        break;
      }
      case 'playlists':
      case 'playlist':
        meta.playlists = Array.isArray(value) ? value : splitList(str(value));
        break;
      case 'madeforkids':
        if (typeof value === 'boolean') meta.madeForKids = value;
        else w.push('madeForKids must be true or false.');
        break;
      case 'language':
      case 'lang':
        meta.language = str(value).trim();
        break;
      case 'thumbnail':
        meta.thumbnail = str(value).trim();
        break;
      case 'channel':
        meta.channel = str(value).trim();
        break;
      case 'pinnedcomment':
      case 'comment':
        meta.pinnedComment = str(value);
        break;
      default:
        w.push(`Unknown front matter key "${rawKey}" was ignored.`);
    }
  }
}

function splitFrontMatter(text: string): { front: string | null; body: string } {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: null, body: text };
}

/**
 * A small YAML subset: `key: value`, quoted strings, `true/false`, numbers, inline lists `[a, "b"]`,
 * block lists (`key:` then `- item` lines), and `#` comments. Enough for metadata files.
 */
export function parseYaml(src: string, warnings: string[] = []): Record<string, YamlValue> {
  const out: Record<string, YamlValue> = {};
  let listKey: string | null = null;
  for (const raw of src.split('\n')) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (out[listKey] as string[]).push(String(scalar(item[1])));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      warnings.push(`Couldn't read front matter line: "${raw.trim()}"`);
      continue;
    }
    const [, key, rest] = kv;
    if (rest === '') {
      out[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    out[key] = rest.trim().startsWith('[') ? inlineList(rest.trim()) : scalar(rest);
  }
  return out;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function scalar(raw: string): string | boolean | number {
  const v = raw.trim();
  const quoted = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v);
  if (quoted) return v.startsWith('"') ? quoted[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : quoted[1].replace(/''/g, "'");
  if (/^(true|yes)$/i.test(v)) return true;
  if (/^(false|no)$/i.test(v)) return false;
  return v;
}

function inlineList(raw: string): string[] {
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
  const items: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ',') {
      items.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  items.push(cur.trim());
  return items.filter(Boolean);
}

interface Section {
  name: string;
  lines: string[];
}

/** Splits on markdown headings (any level), ignoring `#` lines inside fenced blocks. */
function splitSections(body: string): Section[] {
  const sections: Section[] = [{ name: '', lines: [] }];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) fence = null;
    }
    const h = !fence && !f ? /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h) sections.push({ name: stripInline(h[1]).toLowerCase(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections;
}

function findSection(sections: Section[], match: (name: string) => boolean): string[] | null {
  return sections.find((s) => match(s.name.replace(/[:]/g, '').trim()))?.lines ?? null;
}

/** Content of the first fenced code block, exactly as written (no trailing newline). */
function firstFence(lines: string[]): string | null {
  let fence: string | null = null;
  const out: string[] = [];
  for (const line of lines) {
    if (!fence) {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (m) fence = m[1];
      continue;
    }
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) return out.join('\n');
    out.push(line);
  }
  return fence ? out.join('\n') : null;
}

function tagsFromTable(body: string): string[] | null {
  for (const line of body.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4 || cells[0] !== '') continue;
    if (stripInline(cells[1]).toLowerCase() === 'tags') {
      return splitList(stripInline(cells.slice(2, -1).join('|')).replace(/`/g, ''));
    }
  }
  return null;
}

function tagsFromSection(lines: string[] | null): string[] | null {
  if (!lines) return null;
  const block = firstFence(lines);
  if (block != null) return splitList(block);
  const text = lines.join('\n').trim();
  return text ? splitList(text) : null;
}

function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^[-*]\s+/, '').replace(/^#/, ''))
    .filter(Boolean);
}

/** Removes markdown quote/bold/italic/code markers from a single line. */
function stripInline(line: string): string {
  return line
    .trim()
    .replace(/^>\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}
