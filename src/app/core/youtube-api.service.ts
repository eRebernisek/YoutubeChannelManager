import { Injectable, inject } from '@angular/core';
import { ApiError, toApiError } from './api-error';
import { AuthService } from './auth.service';
import { QuotaMethod } from './quota-costs';
import { QuotaService } from './quota.service';
import {
  ApiErrorBody,
  Channel,
  LiveBroadcast,
  ListResponse,
  Playlist,
  PlaylistItem,
  Video,
  VideoCategory,
} from './youtube.models';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';

type Params = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  params?: Params;
  body?: unknown;
  /** Raw body (e.g. an image) sent as-is with its own content type. */
  blob?: Blob;
  base?: string;
}

/**
 * Thin wrapper over the YouTube Data API v3 REST endpoints. Every call goes through `request`, which
 * attaches the active channel's token, logs the quota estimate, retries once after a 401, and turns
 * error bodies into readable messages.
 */
@Injectable({ providedIn: 'root' })
export class YoutubeApiService {
  private readonly auth = inject(AuthService);
  private readonly quota = inject(QuotaService);

  async request<T>(
    method: QuotaMethod,
    httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = new URL((opts.base ?? API) + path);
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const send = async (token: string) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      let body: BodyInit | undefined;
      if (opts.blob) {
        body = opts.blob;
        headers['Content-Type'] = opts.blob.type || 'application/octet-stream';
      } else if (opts.body !== undefined) {
        body = JSON.stringify(opts.body);
        headers['Content-Type'] = 'application/json';
      }
      this.quota.record(method);
      try {
        return await fetch(url, { method: httpMethod, headers, body });
      } catch {
        throw toApiError(0, null);
      }
    };

    let res = await send(await this.auth.accessToken());
    if (res.status === 401) res = await send(await this.auth.tokenRejected());
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw toApiError(res.status, errBody);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ---- channels -------------------------------------------------------------------------------

  async myChannel(parts = 'snippet,statistics,contentDetails'): Promise<Channel> {
    const res = await this.request<ListResponse<Channel>>('channels.list', 'GET', '/channels', {
      params: { mine: true, part: parts },
    });
    const ch = res.items?.[0];
    if (!ch) throw new ApiError('No channel found for this account.', 404);
    return ch;
  }

  // ---- videos ---------------------------------------------------------------------------------

  /** One page of the uploads playlist (1 unit), newest first. Never use search.list for this. */
  uploadsPage(playlistId: string, pageToken?: string, maxResults = 50) {
    return this.request<ListResponse<PlaylistItem>>('playlistItems.list', 'GET', '/playlistItems', {
      params: { playlistId, part: 'snippet,contentDetails', maxResults, pageToken },
    });
  }

  /** Full video resources, fetched in batches of 50 IDs. Keeps the order of `ids`. */
  async videos(
    ids: string[],
    parts = 'snippet,status,contentDetails,statistics,liveStreamingDetails',
  ): Promise<Video[]> {
    const out: Video[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const res = await this.request<ListResponse<Video>>('videos.list', 'GET', '/videos', {
        params: { id: chunk.join(','), part: parts, maxResults: 50 },
      });
      const byId = new Map(res.items.map((v) => [v.id, v]));
      for (const id of chunk) {
        const v = byId.get(id);
        if (v) out.push(v);
      }
    }
    return out;
  }

  async video(id: string, parts?: string): Promise<Video> {
    const [v] = await this.videos([id], parts);
    if (!v) throw new ApiError('Video not found.', 404, 'videoNotFound');
    return v;
  }

  /**
   * `videos.update` replaces every part it receives, so callers must pass full parts that were
   * read first (spec §0.6). Use `VideoEditor` instead of calling this directly.
   */
  updateVideo(video: Pick<Video, 'id'> & Partial<Video>, parts: ('snippet' | 'status')[]) {
    const body: Record<string, unknown> = { id: video.id };
    for (const p of parts) body[p] = video[p];
    return this.request<Video>('videos.update', 'PUT', '/videos', {
      params: { part: parts.join(',') },
      body,
    });
  }

  deleteVideo(id: string) {
    return this.request<void>('videos.delete', 'DELETE', '/videos', { params: { id } });
  }

  setThumbnail(videoId: string, image: Blob) {
    return this.request<unknown>('thumbnails.set', 'POST', '/thumbnails/set', {
      base: UPLOAD_API,
      params: { videoId, uploadType: 'media' },
      blob: image,
    });
  }

  categories(regionCode = 'BR') {
    return this.request<ListResponse<VideoCategory>>(
      'videoCategories.list',
      'GET',
      '/videoCategories',
      { params: { part: 'snippet', regionCode, hl: 'en' } },
    );
  }

  // ---- playlists & comments -------------------------------------------------------------------

  async myPlaylists(): Promise<Playlist[]> {
    const out: Playlist[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.request<ListResponse<Playlist>>('playlists.list', 'GET', '/playlists', {
        params: { mine: true, part: 'snippet,status,contentDetails', maxResults: 50, pageToken },
      });
      out.push(...res.items);
      pageToken = res.nextPageToken;
    } while (pageToken);
    return out;
  }

  addToPlaylist(playlistId: string, videoId: string) {
    return this.request<unknown>('playlistItems.insert', 'POST', '/playlistItems', {
      params: { part: 'snippet' },
      body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
    });
  }

  /** Posts a top-level comment as the channel. The API can't pin it (spec §0.4). */
  postComment(videoId: string, text: string) {
    return this.request<unknown>('commentThreads.insert', 'POST', '/commentThreads', {
      params: { part: 'snippet' },
      body: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } },
    });
  }

  // ---- live -----------------------------------------------------------------------------------

  broadcasts(broadcastStatus: 'active' | 'upcoming' | 'completed' | 'all', maxResults = 10) {
    return this.request<ListResponse<LiveBroadcast>>(
      'liveBroadcasts.list',
      'GET',
      '/liveBroadcasts',
      { params: { part: 'snippet,status', broadcastStatus, broadcastType: 'all', maxResults } },
    );
  }
}
