import { Injectable, computed, inject, signal } from '@angular/core';
import { ChannelsService } from './channels.service';
import { allKeys, readJson, writeJson } from './storage';
import { PrivacyStatus } from './youtube.models';

export interface UploadDefaults {
  categoryId: string;
  language: string;
  madeForKids: boolean;
  license: 'youtube' | 'creativeCommon';
  embeddable: boolean;
  privacy: PrivacyStatus;
  /** Playlists every upload on this channel is added to. */
  playlistIds: string[];
}

export interface ChannelSettings {
  upload: UploadDefaults;
  /** Daily batch publish slots, "HH:mm" in São Paulo time. */
  scheduleSlots: string[];
}

export const DEFAULT_SETTINGS: ChannelSettings = {
  upload: {
    categoryId: '20',
    language: 'en',
    madeForKids: false,
    license: 'youtube',
    embeddable: true,
    privacy: 'public',
    playlistIds: [],
  },
  scheduleSlots: ['00:00', '12:00', '18:00'],
};

const key = (channelId: string) => `settings.${channelId}`;

/** Per-channel settings (spec §2.1), stored under `settings.<channelId>`. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly channels = inject(ChannelsService);
  private readonly version = signal(0);

  /** Settings of the active channel (defaults when none is active). */
  readonly current = computed<ChannelSettings>(() => {
    this.version();
    const id = this.channels.activeId();
    return id ? this.forChannel(id) : DEFAULT_SETTINGS;
  });

  forChannel(channelId: string): ChannelSettings {
    const saved = readJson<Partial<ChannelSettings>>(key(channelId), {});
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      upload: { ...DEFAULT_SETTINGS.upload, ...saved.upload },
    };
  }

  save(channelId: string, settings: ChannelSettings): void {
    writeJson(key(channelId), settings);
    this.version.update((v) => v + 1);
  }

  /** Every app setting (all channels) as a JSON string. Access tokens are never included. */
  exportAll(): string {
    const data: Record<string, unknown> = {};
    for (const k of allKeys()) data[k] = readJson(k, null);
    return JSON.stringify({ app: 'YoutubeChannelManager', version: 1, data }, null, 2);
  }

  /** Restores an export. Returns how many keys were written; reload afterwards. */
  importAll(json: string): number {
    const parsed = JSON.parse(json) as { app?: string; data?: Record<string, unknown> };
    if (parsed.app !== 'YoutubeChannelManager' || !parsed.data) {
      throw new Error('This file is not a YoutubeChannelManager settings export.');
    }
    const entries = Object.entries(parsed.data).filter(([k]) => !k.startsWith('auth.'));
    for (const [k, v] of entries) writeJson(k, v);
    this.version.update((v) => v + 1);
    return entries.length;
  }
}
