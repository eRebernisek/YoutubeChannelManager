import { Video, VideoSnippet, VideoStatus } from './youtube.models';

/** "PT1H2M3S" → seconds. */
export function parseDuration(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return 0;
  const [d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

export type VideoKind = 'Live/VOD' | 'Short' | 'Video';

/** IDs from the channel's system playlists, which hold YouTube's own Shorts/live classification. */
export interface VideoKinds {
  shorts: Set<string>;
  lives: Set<string>;
}

/**
 * Undocumented system playlist for a channel: `UC…` with `UC` replaced by `UUSH` (Shorts), `UULF`
 * (long-form videos) or `UULV` (lives). Returns null for IDs that don't start with `UC`.
 */
export function systemPlaylistId(channelId: string, prefix: 'UUSH' | 'UULF' | 'UULV'): string | null {
  return channelId.startsWith('UC') ? prefix + channelId.slice(2) : null;
}

const SHORTS_TAG = /#shorts\b/i;

/**
 * The API has no "is Short" flag, so this uses the channel's Shorts and lives playlists. Those only
 * list public videos, so a non-public video counts as a Short when it's tagged `#shorts`. Without
 * `kinds`, only lives and that tag are detected.
 */
export function videoKind(v: Video, kinds?: VideoKinds | null): VideoKind {
  if (v.liveStreamingDetails || kinds?.lives.has(v.id)) return 'Live/VOD';
  if (kinds?.shorts.has(v.id)) return 'Short';
  if (
    v.status.privacyStatus !== 'public' &&
    (SHORTS_TAG.test(v.snippet.title) || SHORTS_TAG.test(v.snippet.description ?? ''))
  ) {
    return 'Short';
  }
  return 'Video';
}

/**
 * Only the snippet fields `videos.update` accepts. The whole snippet must be sent, because missing
 * fields are deleted (spec §0.6), so this starts from the full snippet that was read.
 */
export function writableSnippet(s: VideoSnippet): VideoSnippet {
  const out: VideoSnippet = {
    title: s.title,
    description: s.description ?? '',
    categoryId: s.categoryId,
  };
  if (s.tags?.length) out.tags = s.tags;
  if (s.defaultLanguage) out.defaultLanguage = s.defaultLanguage;
  if (s.defaultAudioLanguage) out.defaultAudioLanguage = s.defaultAudioLanguage;
  return out;
}

/** Only the status fields `videos.update` accepts. `publishAt` is kept only for private videos. */
export function writableStatus(s: VideoStatus): VideoStatus {
  const out: VideoStatus = { privacyStatus: s.privacyStatus };
  if (s.selfDeclaredMadeForKids !== undefined) out.selfDeclaredMadeForKids = s.selfDeclaredMadeForKids;
  else if (s.madeForKids !== undefined) out.selfDeclaredMadeForKids = s.madeForKids;
  if (s.license) out.license = s.license;
  if (s.embeddable !== undefined) out.embeddable = s.embeddable;
  if (s.publicStatsViewable !== undefined) out.publicStatsViewable = s.publicStatsViewable;
  if (s.containsSyntheticMedia !== undefined) out.containsSyntheticMedia = s.containsSyntheticMedia;
  if (s.privacyStatus === 'private' && s.publishAt) out.publishAt = s.publishAt;
  return out;
}

const CHAPTER_LINE = /^\s*[[(]?(\d{1,2}:)?\d{1,2}:\d{2}[\])]?\s*[-–—:]?\s*\S/;

/**
 * Moves the chapter lines ("00:00 Intro", "1:02:03 - Finals") to the top of the description, keeping
 * their order, followed by a blank line and the rest. Returns the text unchanged if it has fewer than
 * 3 chapter lines (YouTube needs at least 3 to show chapters).
 */
export function moveChaptersToTop(description: string): string {
  const lines = description.replace(/\r\n/g, '\n').split('\n');
  const chapters = lines.filter((l) => CHAPTER_LINE.test(l));
  if (chapters.length < 3) return description;
  const rest = lines.filter((l) => !CHAPTER_LINE.test(l));
  while (rest.length && !rest[0].trim()) rest.shift();
  const body = rest.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return chapters.map((l) => l.trim()).join('\n') + (body ? '\n\n' + body : '');
}

/** YouTube's metadata limits (validated before any upload or update). */
export function validateMetadata(m: {
  title: string;
  description: string;
  tags: string[];
}): string[] {
  const errors: string[] = [];
  if (!m.title.trim()) errors.push('Title is required.');
  if (m.title.length > 100) errors.push(`Title is ${m.title.length} characters (max 100).`);
  if (/[<>]/.test(m.title)) errors.push('Title cannot contain < or >.');
  const descBytes = new TextEncoder().encode(m.description).length;
  if (descBytes > 5000) errors.push(`Description is ${descBytes} bytes (max 5,000).`);
  if (/[<>]/.test(m.description)) errors.push('Description cannot contain < or >.');
  // YouTube counts tags with spaces as if they were quoted (+2 chars) and separates them by commas.
  const tagChars = m.tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0) +
    Math.max(0, m.tags.length - 1);
  if (tagChars > 500) errors.push(`Tags use ${tagChars} characters (max 500).`);
  return errors;
}

/** Splits "a, b,c" or one-per-line text into clean tags. */
export function parseTags(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
}
