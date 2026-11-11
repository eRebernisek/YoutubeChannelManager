import { ApiErrorBody } from './youtube.models';

/** Readable messages for the YouTube error reasons users actually hit (spec §6). */
const REASONS: Record<string, string> = {
  quotaExceeded:
    "Today's YouTube API quota is used up. It resets at midnight Pacific Time (about 4–5 AM in São Paulo).",
  dailyLimitExceeded:
    "Today's YouTube API quota is used up. It resets at midnight Pacific Time.",
  rateLimitExceeded: 'Too many requests in a short time. Wait a moment and try again.',
  userRateLimitExceeded: 'Too many requests in a short time. Wait a moment and try again.',
  uploadLimitExceeded: 'This channel hit its YouTube upload limit for now. Try again later.',
  forbidden: "YouTube refused this action for this channel. Check that you're on the right channel.",
  insufficientPermissions: 'A permission is missing. Sign out and sign in again, granting every permission.',
  invalidPublishAt:
    'Invalid schedule time. It must be in the future, and the video must be private and never published.',
  invalidTitle: 'Invalid title: max 100 characters, and no < or >.',
  invalidDescription: 'Invalid description: max 5,000 bytes, and no < or >.',
  invalidTags: 'Invalid tags: max 500 characters in total.',
  invalidCategoryId: 'Invalid category.',
  videoNotFound: "Video not found. It may have been deleted, or belongs to another channel.",
  playlistNotFound: 'Playlist not found.',
  mediaBodyRequired: 'The video file is missing.',
  uploadRateLimitExceeded: 'Uploading too fast. Wait a little and try again.',
  invalidImage: 'Invalid thumbnail image: use JPG or PNG, max 2 MB.',
  mediaBodyTooLarge: 'Thumbnail is too large: max 2 MB.',
  customThumbnailsNotAllowed:
    'This channel can’t use custom thumbnails yet. Verify the channel with a phone number in YouTube Studio.',
  liveChatEnded: 'The live chat has ended.',
  liveChatDisabled: 'Live chat is disabled for this broadcast.',
  commentsDisabled: 'Comments are disabled on this video.',
  authError: 'Your session expired. Sign in again.',
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
  }
}

export function toApiError(status: number, body: ApiErrorBody | null): ApiError {
  const reason = body?.error?.errors?.[0]?.reason;
  const raw = body?.error?.message;
  const message =
    (reason && REASONS[reason]) ||
    raw ||
    (status === 0 ? 'Network error. Check your connection.' : `YouTube API error (HTTP ${status}).`);
  return new ApiError(message, status, reason);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
