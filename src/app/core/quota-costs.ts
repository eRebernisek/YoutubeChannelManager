/**
 * Estimated YouTube Data API quota cost per call, in units (spec §0.2).
 * Google changes these; check https://developers.google.com/youtube/v3/determine_quota_cost
 * and update this table (or override it in Settings).
 */
export const DAILY_QUOTA = 10_000;

export const QUOTA_COSTS = {
  'channels.list': 1,
  'channels.update': 50,
  'channelBanners.insert': 50,
  'channelSections.list': 1,
  'channelSections.insert': 50,
  'channelSections.update': 50,
  'channelSections.delete': 50,
  'videos.list': 1,
  'videos.insert': 1600,
  'videos.update': 50,
  'videos.delete': 50,
  'thumbnails.set': 50,
  'playlists.list': 1,
  'playlists.insert': 50,
  'playlists.update': 50,
  'playlists.delete': 50,
  'playlistItems.list': 1,
  'playlistItems.insert': 50,
  'playlistItems.update': 50,
  'playlistItems.delete': 50,
  'search.list': 100,
  'commentThreads.list': 1,
  'commentThreads.insert': 50,
  'comments.list': 1,
  'comments.insert': 50,
  'comments.update': 50,
  'comments.delete': 50,
  'comments.setModerationStatus': 50,
  'captions.list': 50,
  'captions.insert': 400,
  'captions.update': 450,
  'captions.download': 200,
  'captions.delete': 50,
  'liveBroadcasts.list': 1,
  'liveBroadcasts.insert': 50,
  'liveBroadcasts.update': 50,
  'liveBroadcasts.bind': 50,
  'liveBroadcasts.delete': 50,
  'liveStreams.list': 1,
  'liveChatMessages.list': 5,
  'liveChatMessages.insert': 50,
  'liveChatMessages.delete': 50,
  'liveChatBans.insert': 50,
  'liveChatModerators.insert': 50,
  'liveChatModerators.delete': 50,
  'videoCategories.list': 1,
  'watermarks.set': 50,
  'watermarks.unset': 50,
} as const satisfies Record<string, number>;

export type QuotaMethod = keyof typeof QUOTA_COSTS;
