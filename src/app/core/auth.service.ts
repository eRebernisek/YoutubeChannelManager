import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { ChannelsService } from './channels.service';
import { QuotaService } from './quota.service';
import { readJson, removeKey, writeJson } from './storage';
import { ToastService } from './toast.service';

export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.upload',
];

interface StoredToken {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** Refresh this long before the token actually expires. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
const TOKENS_KEY = 'auth.tokens';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly kind: 'not-configured' | 'popup' | 'denied' | 'scopes' | 'expired' | 'network',
  ) {
    super(message);
  }
}

/**
 * Google sign-in with the GIS token model. One access token per channel, kept in memory and
 * sessionStorage only (never localStorage). There are no refresh tokens: an expired token is
 * replaced through GIS again (spec §2).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly channels = inject(ChannelsService);
  private readonly toast = inject(ToastService);
  private readonly quota = inject(QuotaService);

  private readonly tokens = signal<Record<string, StoredToken>>(
    readJson(TOKENS_KEY, {}, sessionStorage),
  );
  private gisLoad?: Promise<void>;
  private refreshInFlight?: Promise<string>;
  private readonly locks = signal<string[]>([]);

  readonly configured = !!environment.googleClientId;
  readonly busy = signal(false);
  /** Set when a silent refresh failed and the user must click "Sign in again". */
  readonly sessionExpired = signal(false);

  readonly signedIn = computed(() => {
    const id = this.channels.activeId();
    return !!id && !!this.tokens()[id];
  });
  /** Why the channel picker is locked (an upload, batch or chat bot is running), if it is. */
  readonly lockReason = computed(() => this.locks()[0] ?? null);

  hasToken(channelId: string): boolean {
    const t = this.tokens()[channelId];
    return !!t && t.expiresAt > Date.now();
  }

  /** Opens Google's chooser; whichever channel the user picks becomes active. */
  async addChannel(): Promise<void> {
    await this.signInInteractive();
  }

  /**
   * Makes `channelId` active. Instant when its token is still valid, otherwise opens Google's
   * chooser. If the user picks another channel, that one becomes active instead (spec §2.1).
   */
  async switchTo(channelId: string): Promise<void> {
    if (!this.confirmUnlocked()) return;
    if (this.hasToken(channelId)) {
      this.channels.setActive(channelId);
      return;
    }
    const target = this.channels.get(channelId);
    this.toast.show(`Pick "${this.channels.displayName(target) || channelId}" in Google's list.`);
    const picked = await this.signInInteractive();
    if (picked && picked !== channelId) {
      const name = this.channels.displayName(this.channels.get(picked));
      this.toast.show(`You picked ${name}, so it's now the active channel.`, 'info', 6000);
    }
  }

  /** A valid access token for the active channel, refreshing it when needed. */
  async accessToken(): Promise<string> {
    const id = this.channels.activeId();
    if (!id) throw new AuthError('Sign in and pick a channel first.', 'expired');
    const t = this.tokens()[id];
    if (t && t.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return t.accessToken;
    return this.refresh(id);
  }

  /** Called by the API layer after a 401: forget the token and get a new one. */
  async tokenRejected(): Promise<string> {
    const id = this.channels.activeId();
    if (!id) throw new AuthError('Sign in and pick a channel first.', 'expired');
    this.dropToken(id);
    return this.refresh(id);
  }

  /** "Sign in again" button after a failed silent refresh. */
  async reauthenticate(): Promise<void> {
    const id = this.channels.activeId();
    if (id) await this.switchTo(id);
    else await this.addChannel();
  }

  signOut(): void {
    for (const t of Object.values(this.tokens())) {
      if (window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.accessToken);
    }
    this.tokens.set({});
    removeKey(TOKENS_KEY, sessionStorage);
    this.channels.setActive(null);
    this.sessionExpired.set(false);
  }

  forgetChannel(id: string): void {
    const t = this.tokens()[id];
    if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.accessToken);
    this.dropToken(id);
    this.channels.forget(id);
  }

  /** Locks the channel picker while a job runs on the active channel. Returns the unlock fn. */
  lock(reason: string): () => void {
    this.locks.update((l) => [...l, reason]);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locks.update((l) => {
        const i = l.indexOf(reason);
        return i < 0 ? l : [...l.slice(0, i), ...l.slice(i + 1)];
      });
    };
  }

  private confirmUnlocked(): boolean {
    const reason = this.lockReason();
    if (!reason) return true;
    return confirm(`${reason} is running on the current channel. Switch anyway?`);
  }

  private async signInInteractive(): Promise<string | null> {
    if (!this.confirmUnlocked()) return null;
    this.busy.set(true);
    try {
      const token = await this.requestToken('select_account');
      const channelId = await this.identify(token.accessToken);
      this.storeToken(channelId, token);
      this.channels.setActive(channelId);
      this.sessionExpired.set(false);
      return channelId;
    } catch (e) {
      if (!(e instanceof AuthError && e.kind === 'popup' && /closed/i.test(e.message))) {
        this.toast.error(e instanceof Error ? e.message : String(e));
      }
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  private refresh(channelId: string): Promise<string> {
    this.refreshInFlight ??= this.silentRefresh(channelId).finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async silentRefresh(channelId: string): Promise<string> {
    try {
      const token = await this.requestToken('');
      // A silent refresh can't target a brand channel, so check which channel we got.
      const got = await this.identify(token.accessToken);
      if (got !== channelId) {
        this.storeToken(got, token);
        throw new AuthError(
          'Your Google session returned a different channel. Pick the channel again.',
          'expired',
        );
      }
      this.storeToken(channelId, token);
      this.sessionExpired.set(false);
      return token.accessToken;
    } catch (e) {
      this.dropToken(channelId);
      this.sessionExpired.set(true);
      throw e instanceof AuthError
        ? e
        : new AuthError('Session expired. Sign in again.', 'expired');
    }
  }

  /** Asks Google which channel a token belongs to, and records it in the known list. */
  private async identify(accessToken: string): Promise<string> {
    const url =
      'https://www.googleapis.com/youtube/v3/channels?mine=true&part=snippet,contentDetails';
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new AuthError('Network error while reading your channel.', 'network');
    }
    this.quota.record('channels.list');
    if (!res.ok) throw new AuthError(`Couldn't read your channel (HTTP ${res.status}).`, 'denied');
    const body = (await res.json()) as {
      items?: {
        id: string;
        snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } };
        contentDetails: { relatedPlaylists: { uploads: string } };
      }[];
    };
    const ch = body.items?.[0];
    if (!ch) {
      throw new AuthError(
        "This Google account or brand account has no YouTube channel. Pick one that does.",
        'denied',
      );
    }
    this.channels.upsert({
      id: ch.id,
      title: ch.snippet.title,
      handle: ch.snippet.customUrl,
      avatarUrl: ch.snippet.thumbnails?.default?.url,
      uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads,
    });
    return ch.id;
  }

  private async requestToken(prompt: '' | 'select_account'): Promise<StoredToken> {
    if (!this.configured) {
      throw new AuthError(
        'Google sign-in is not configured yet: add the OAuth client ID to src/environments/environment.ts.',
        'not-configured',
      );
    }
    await this.loadGis();
    return new Promise<StoredToken>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: environment.googleClientId,
        scope: SCOPES.join(' '),
        prompt,
        callback: (res) => {
          if (res.error) {
            reject(new AuthError(res.error_description || res.error, 'denied'));
          } else if (!google.accounts.oauth2.hasGrantedAllScopes(res, ...SCOPES)) {
            reject(
              new AuthError(
                'Some permissions were not granted. Sign in again and tick every checkbox.',
                'scopes',
              ),
            );
          } else {
            resolve({
              accessToken: res.access_token,
              expiresAt: Date.now() + res.expires_in * 1000,
            });
          }
        },
        error_callback: (err) => {
          const msg =
            err.type === 'popup_failed_to_open'
              ? 'The Google sign-in popup was blocked. Allow popups for this site and try again.'
              : err.type === 'popup_closed'
                ? 'Sign-in popup closed.'
                : err.message || 'Google sign-in failed.';
          reject(new AuthError(msg, 'popup'));
        },
      });
      client.requestAccessToken();
    });
  }

  private loadGis(): Promise<void> {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    this.gisLoad ??= new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        this.gisLoad = undefined;
        reject(new AuthError("Couldn't load Google sign-in. Check your connection.", 'network'));
      };
      document.head.appendChild(s);
    });
    return this.gisLoad;
  }

  private storeToken(channelId: string, token: StoredToken): void {
    this.tokens.update((t) => ({ ...t, [channelId]: token }));
    writeJson(TOKENS_KEY, this.tokens(), sessionStorage);
  }

  private dropToken(channelId: string): void {
    this.tokens.update(({ [channelId]: _, ...rest }) => rest);
    writeJson(TOKENS_KEY, this.tokens(), sessionStorage);
  }
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: unknown } };
  }
}
