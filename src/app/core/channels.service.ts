import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { readJson, writeJson } from './storage';

/** A channel the app knows about. Tokens are never stored here (spec §2.1). */
export interface KnownChannel {
  id: string;
  title: string;
  /** User-editable label shown in the picker; falls back to `title`. */
  label?: string;
  handle?: string;
  avatarUrl?: string;
  uploadsPlaylistId?: string;
  note?: string;
  /** False until the user has signed in to this channel at least once. */
  verified: boolean;
  lastUsed?: string;
}

const LIST_KEY = 'channels';
const ACTIVE_KEY = 'channels.active';
const DEFAULT_KEY = 'channels.default';

/** Known channels, the active channel and the default channel, persisted in localStorage. */
@Injectable({ providedIn: 'root' })
export class ChannelsService {
  readonly channels = signal<KnownChannel[]>(this.loadList());
  readonly activeId = signal<string | null>(readJson<string | null>(ACTIVE_KEY, null));
  readonly defaultId = signal<string | null>(readJson<string | null>(DEFAULT_KEY, null));

  readonly active = computed(() => this.channels().find((c) => c.id === this.activeId()) ?? null);

  get(id: string): KnownChannel | undefined {
    return this.channels().find((c) => c.id === id);
  }

  displayName(channel: KnownChannel | null | undefined): string {
    return channel ? channel.label || channel.title : '';
  }

  /** Adds or refreshes a channel from `channels.list` data and marks it used. */
  upsert(info: Omit<KnownChannel, 'verified' | 'lastUsed' | 'label' | 'note'>): void {
    const lastUsed = new Date().toISOString();
    this.channels.update((list) => {
      const existing = list.find((c) => c.id === info.id);
      if (existing) {
        return list.map((c) => (c.id === info.id ? { ...c, ...info, verified: true, lastUsed } : c));
      }
      return [...list, { ...info, verified: true, lastUsed }];
    });
    this.saveList();
  }

  setActive(id: string | null): void {
    this.activeId.set(id);
    writeJson(ACTIVE_KEY, id);
  }

  setDefault(id: string | null): void {
    this.defaultId.set(id);
    writeJson(DEFAULT_KEY, id);
  }

  rename(id: string, label: string): void {
    this.patch(id, { label: label.trim() || undefined });
  }

  setNote(id: string, note: string): void {
    this.patch(id, { note: note.trim() || undefined });
  }

  move(id: string, delta: -1 | 1): void {
    this.channels.update((list) => {
      const i = list.findIndex((c) => c.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    this.saveList();
  }

  forget(id: string): void {
    this.channels.update((list) => list.filter((c) => c.id !== id));
    this.saveList();
    if (this.activeId() === id) this.setActive(null);
    if (this.defaultId() === id) this.setDefault(null);
  }

  /** Finds a known channel by ID or @handle (used by the `.md` `channel:` field). */
  match(ref: string): KnownChannel | undefined {
    const r = ref.trim().toLowerCase();
    const handle = r.startsWith('@') ? r : '@' + r;
    return this.channels().find(
      (c) => c.id.toLowerCase() === r || c.handle?.toLowerCase() === handle,
    );
  }

  private patch(id: string, change: Partial<KnownChannel>): void {
    this.channels.update((list) => list.map((c) => (c.id === id ? { ...c, ...change } : c)));
    this.saveList();
  }

  private saveList(): void {
    writeJson(LIST_KEY, this.channels());
  }

  private loadList(): KnownChannel[] {
    const saved = readJson<KnownChannel[] | null>(LIST_KEY, null);
    if (saved) return saved;
    return environment.seedChannels.map((c) => ({ ...c, verified: false }));
  }
}
