import { writableSnippet, writableStatus } from '../../core/video.util';
import { PrivacyStatus, Video, VideoSnippet, VideoStatus } from '../../core/youtube.models';

export interface BulkOps {
  appendDescription: string;
  prependDescription: string;
  find: string;
  replace: string;
  /** Apply find/replace to titles too, not only descriptions. */
  replaceInTitle: boolean;
  addTags: string[];
  removeTags: string[];
  privacy: PrivacyStatus | '';
}

export const EMPTY_OPS: BulkOps = {
  appendDescription: '',
  prependDescription: '',
  find: '',
  replace: '',
  replaceInTitle: false,
  addTags: [],
  removeTags: [],
  privacy: '',
};

export interface BulkChange {
  video: Video;
  snippet?: VideoSnippet;
  status?: VideoStatus;
  summary: string[];
}

/** What `ops` would change on `video`. Pure, so the preview and the save use the same result. */
export function computeBulkChange(video: Video, ops: BulkOps): BulkChange {
  const summary: string[] = [];
  const before = writableSnippet(video.snippet);
  const snippet: VideoSnippet = { ...before, tags: [...(before.tags ?? [])] };

  if (ops.find) {
    const count = (text: string) => text.split(ops.find).length - 1;
    const inDesc = count(snippet.description);
    if (inDesc) {
      snippet.description = snippet.description.split(ops.find).join(ops.replace);
      summary.push(`description: replaced ${inDesc}×`);
    }
    if (ops.replaceInTitle) {
      const inTitle = count(snippet.title);
      if (inTitle) {
        snippet.title = snippet.title.split(ops.find).join(ops.replace);
        summary.push(`title → "${snippet.title}"`);
      }
    }
  }
  if (ops.prependDescription && !snippet.description.startsWith(ops.prependDescription)) {
    snippet.description = ops.prependDescription + '\n\n' + snippet.description;
    summary.push('description: text added at top');
  }
  if (ops.appendDescription && !snippet.description.endsWith(ops.appendDescription)) {
    snippet.description = snippet.description.trimEnd() + '\n\n' + ops.appendDescription;
    summary.push('description: text added at bottom');
  }

  const lower = new Set(snippet.tags!.map((t) => t.toLowerCase()));
  const added = ops.addTags.filter((t) => !lower.has(t.toLowerCase()));
  const removeSet = new Set(ops.removeTags.map((t) => t.toLowerCase()));
  const kept = snippet.tags!.filter((t) => !removeSet.has(t.toLowerCase()));
  const removed = snippet.tags!.length - kept.length;
  snippet.tags = [...kept, ...added];
  if (added.length) summary.push(`tags +${added.length}`);
  if (removed) summary.push(`tags −${removed}`);
  if (!snippet.tags.length) delete snippet.tags;

  let status: VideoStatus | undefined;
  if (ops.privacy && ops.privacy !== video.status.privacyStatus) {
    status = writableStatus({ ...video.status, privacyStatus: ops.privacy });
    const lostSchedule = video.status.publishAt && !status.publishAt;
    summary.push(
      `privacy ${video.status.privacyStatus} → ${ops.privacy}${lostSchedule ? ' (removes schedule)' : ''}`,
    );
  }

  const snippetChanged = JSON.stringify(snippet) !== JSON.stringify(before);
  return { video, snippet: snippetChanged ? snippet : undefined, status, summary };
}
