/** The subset of YouTube Data API v3 resources this app reads and writes. */

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

export type Thumbnails = Partial<Record<'default' | 'medium' | 'high' | 'standard' | 'maxres', Thumbnail>>;

export type PrivacyStatus = 'public' | 'unlisted' | 'private';

export interface ListResponse<T> {
  items: T[];
  nextPageToken?: string;
  pageInfo?: { totalResults: number; resultsPerPage: number };
}

export interface Channel {
  id: string;
  snippet: {
    title: string;
    description: string;
    customUrl?: string;
    thumbnails: Thumbnails;
    country?: string;
    defaultLanguage?: string;
  };
  statistics?: {
    viewCount: string;
    subscriberCount: string;
    hiddenSubscriberCount: boolean;
    videoCount: string;
  };
  contentDetails?: { relatedPlaylists: { uploads: string } };
  status?: { isLinked: boolean; longUploadsStatus: string };
}

export interface VideoSnippet {
  title: string;
  description: string;
  tags?: string[];
  categoryId: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  publishedAt?: string;
  channelId?: string;
  thumbnails?: Thumbnails;
  liveBroadcastContent?: 'live' | 'upcoming' | 'none';
}

export interface VideoStatus {
  privacyStatus: PrivacyStatus;
  publishAt?: string;
  selfDeclaredMadeForKids?: boolean;
  madeForKids?: boolean;
  license?: 'youtube' | 'creativeCommon';
  embeddable?: boolean;
  publicStatsViewable?: boolean;
  uploadStatus?: 'uploaded' | 'processed' | 'failed' | 'rejected' | 'deleted';
  containsSyntheticMedia?: boolean;
}

export interface Video {
  id: string;
  snippet: VideoSnippet;
  status: VideoStatus;
  contentDetails?: { duration: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
    scheduledStartTime?: string;
    activeLiveChatId?: string;
  };
}

export interface PlaylistItem {
  id: string;
  snippet: { title: string; publishedAt: string; thumbnails: Thumbnails };
  contentDetails: { videoId: string; videoPublishedAt?: string };
}

export interface Playlist {
  id: string;
  snippet: { title: string; description: string; thumbnails?: Thumbnails };
  status?: { privacyStatus: PrivacyStatus };
  contentDetails?: { itemCount: number };
}

export interface VideoCategory {
  id: string;
  snippet: { title: string; assignable: boolean };
}

export interface LiveBroadcast {
  id: string;
  snippet: {
    title: string;
    description: string;
    scheduledStartTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
    liveChatId?: string;
    thumbnails?: Thumbnails;
  };
  status: { lifeCycleStatus: string; privacyStatus: PrivacyStatus };
}

/** Shape of a YouTube API error body. */
export interface ApiErrorBody {
  error?: {
    code: number;
    message: string;
    errors?: { reason: string; message: string; domain?: string }[];
  };
}
