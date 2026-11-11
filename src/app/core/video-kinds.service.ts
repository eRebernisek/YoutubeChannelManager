import { Injectable, computed, inject, signal } from '@angular/core';
import { ChannelsService } from './channels.service';
import { VideoKinds, systemPlaylistId } from './video.util';
import { YoutubeApiService } from './youtube-api.service';

/** Stops a runaway read on huge channels: 40 pages × 50 = 2,000 IDs per playlist. */
const MAX_PAGES = 40;

/**
 * Shorts and live IDs for each channel, read from YouTube's system playlists (`UUSH…`, `UULV…`)
 * once per session, so lists can tell Shorts from Videos the way YouTube does.
 */
@Injectable({ providedIn: 'root' })
export class VideoKindsService {
  private readonly api = inject(YoutubeApiService);
  private readonly channels = inject(ChannelsService);

  private readonly byChannel = signal<Record<string, VideoKinds>>({});
  private readonly inFlight = new Map<string, Promise<VideoKinds>>();

  /** Sets for the active channel, or null until they're loaded. */
  readonly kinds = computed(() => {
    const id = this.channels.activeId();
    return id ? (this.byChannel()[id] ?? null) : null;
  });

  /** Loads the sets for `channelId`, reusing the cached ones unless `force` is set. */
  load(channelId: string, force = false): Promise<VideoKinds> {
    const cached = this.byChannel()[channelId];
    if (cached && !force) return Promise.resolve(cached);
    let pending = this.inFlight.get(channelId);
    if (pending && !force) return pending;
    pending = this.fetch(channelId).finally(() => this.inFlight.delete(channelId));
    this.inFlight.set(channelId, pending);
    return pending;
  }

  private async fetch(channelId: string): Promise<VideoKinds> {
    const [shorts, lives] = await Promise.all([
      this.readAll(systemPlaylistId(channelId, 'UUSH')),
      this.readAll(systemPlaylistId(channelId, 'UULV')),
    ]);
    const kinds = { shorts, lives };
    this.byChannel.update((m) => ({ ...m, [channelId]: kinds }));
    return kinds;
  }

  private async readAll(playlistId: string | null): Promise<Set<string>> {
    const ids = new Set<string>();
    if (!playlistId) return ids;
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.api.playlistVideoIds(playlistId, pageToken);
      for (const id of res.ids) ids.add(id);
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
    return ids;
  }
}
