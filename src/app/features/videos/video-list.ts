import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { errorMessage } from '../../core/api-error';
import { ChannelsService } from '../../core/channels.service';
import { videoKind } from '../../core/video.util';
import { YoutubeApiService } from '../../core/youtube-api.service';
import { Video } from '../../core/youtube.models';
import { VideoRow } from '../../shared/video-row';
import { BulkEdit } from './bulk-edit';

type PrivacyFilter = 'public' | 'unlisted' | 'private' | 'scheduled';
type KindFilter = 'Short' | 'Video' | 'Live/VOD';
type PageSize = 10 | 20 | 30;

/** Effective sort date: scheduled publish time when set, otherwise publishedAt. Newest first. */
function sortDate(v: Video): number {
  if (v.status.publishAt) {
    const at = Date.parse(v.status.publishAt);
    if (!Number.isNaN(at)) return at;
  }
  return v.snippet.publishedAt ? Date.parse(v.snippet.publishedAt) : 0;
}

/** The channel's videos from the uploads playlist (1 unit per 50), with filters and bulk edit. */
@Component({
  selector: 'app-video-list',
  imports: [VideoRow, BulkEdit],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="page-head">
        <h1>Videos</h1>
        <span class="muted small">{{ videos().length }} loaded{{ nextPage() ? '' : ' (all)' }}</span>
        <span class="spacer"></span>
        <button type="button" class="sm" (click)="reload()" [disabled]="loading()">Refresh</button>
      </div>

      <div class="card row">
        <input
          type="search"
          placeholder="Filter by title, description or tag"
          style="flex: 1; min-width: 200px"
          [value]="text()"
          (input)="onText($any($event.target).value)"
        />
        <select [value]="privacy()" (change)="onPrivacy($any($event.target).value)" aria-label="Privacy">
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
          <option value="scheduled">Scheduled</option>
        </select>
        <select [value]="kind()" (change)="onKind($any($event.target).value)" aria-label="Type">
          <option value="Video">Videos</option>
          <option value="Short">Shorts (≤ 3 min)</option>
          <option value="Live/VOD">Live / VODs</option>
        </select>
        <select [value]="pageSize()" (change)="onPageSize(+$any($event.target).value)" aria-label="Per page">
          <option [value]="10">10 per page</option>
          <option [value]="20">20 per page</option>
          <option [value]="30">30 per page</option>
        </select>
      </div>

      @if (error(); as err) {
        <p class="alert error">{{ err }}</p>
      }

      @if (selected().size) {
        <app-bulk-edit [videos]="selectedVideos()" (done)="afterBulk($event)" (cancel)="clearSelection()" />
      }

      <div class="card" style="padding: 0">
        @if (paged().length) {
          <div class="list-item small">
            <label class="check">
              <input type="checkbox" [checked]="allSelected()" (change)="toggleAll()" />
              Select {{ paged().length }} on this page
            </label>
            @if (selected().size) {
              <span class="muted">· {{ selected().size }} selected</span>
            }
            <span class="spacer"></span>
            <span class="muted">{{ rangeLabel() }}</span>
          </div>
        }
        @for (v of paged(); track v.id) {
          <div class="sel-row">
            <input
              type="checkbox"
              [attr.aria-label]="'Select ' + v.snippet.title"
              [checked]="selected().has(v.id)"
              (change)="toggle(v.id)"
            />
            <app-video-row [video]="v" />
          </div>
        } @empty {
          @if (!loading()) {
            <p class="muted" style="padding: 1rem">No videos match.</p>
          }
        }
      </div>

      @if (filtered().length) {
        <div class="row pager">
          <button type="button" class="sm" [disabled]="page() <= 0" (click)="goPage(page() - 1)">
            Previous
          </button>
          <span class="muted small">Page {{ page() + 1 }} of {{ totalPages() }}</span>
          <button
            type="button"
            class="sm"
            [disabled]="page() >= totalPages() - 1"
            (click)="goPage(page() + 1)"
          >
            Next
          </button>
        </div>
      }

      @if (loading()) {
        <div class="spinner"></div>
      } @else if (nextPage()) {
        <div class="row">
          <button type="button" (click)="loadMore()">Load 50 more</button>
          <button type="button" class="ghost" (click)="loadAll()">Load all</button>
          <span class="muted small">Filters only apply to loaded videos. ~2 units per 50.</span>
        </div>
      }
    </section>
  `,
  styles: `
    .sel-row {
      display: flex;
      align-items: center;
      padding-left: 0.75rem;
      border-bottom: 1px solid var(--line);
      app-video-row {
        flex: 1;
        min-width: 0;
      }
      ::ng-deep .list-item {
        border-bottom: 0;
      }
    }
    .pager {
      justify-content: center;
      gap: 0.75rem;
    }
  `,
})
export class VideoList {
  private readonly api = inject(YoutubeApiService);
  private readonly channels = inject(ChannelsService);

  protected readonly videos = signal<Video[]>([]);
  protected readonly nextPage = signal<string | undefined>(undefined);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly text = signal('');
  protected readonly privacy = signal<PrivacyFilter>('public');
  protected readonly kind = signal<KindFilter>('Video');
  protected readonly pageSize = signal<PageSize>(10);
  protected readonly page = signal(0);
  protected readonly selected = signal(new Set<string>());

  protected readonly filtered = computed(() => {
    const q = this.text().trim().toLowerCase();
    const privacy = this.privacy();
    const kind = this.kind();
    const now = Date.now();
    return this.videos()
      .filter((v) => {
        const scheduled = !!v.status.publishAt && Date.parse(v.status.publishAt) > now;
        if (privacy === 'scheduled' ? !scheduled : v.status.privacyStatus !== privacy) {
          return false;
        }
        if (videoKind(v) !== kind) return false;
        if (!q) return true;
        return (
          v.snippet.title.toLowerCase().includes(q) ||
          v.snippet.description?.toLowerCase().includes(q) ||
          !!v.snippet.tags?.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => sortDate(b) - sortDate(a));
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / this.pageSize())),
  );

  protected readonly paged = computed(() => {
    const size = this.pageSize();
    const start = this.page() * size;
    return this.filtered().slice(start, start + size);
  });

  protected readonly rangeLabel = computed(() => {
    const total = this.filtered().length;
    if (!total) return '0 of 0';
    const size = this.pageSize();
    const start = this.page() * size + 1;
    const end = Math.min(total, start + size - 1);
    return `${start}–${end} of ${total}`;
  });

  protected readonly selectedVideos = computed(() =>
    this.videos().filter((v) => this.selected().has(v.id)),
  );
  protected readonly allSelected = computed(
    () => this.paged().length > 0 && this.paged().every((v) => this.selected().has(v.id)),
  );

  private uploadsId?: string;
  private generation = 0;

  constructor() {
    effect(() => {
      this.channels.activeId();
      untracked(() => void this.reload());
    });
    effect(() => {
      const max = this.totalPages() - 1;
      if (this.page() > max) this.page.set(max);
    });
  }

  protected onText(value: string): void {
    this.text.set(value);
    this.page.set(0);
  }

  protected onPrivacy(value: PrivacyFilter): void {
    this.privacy.set(value);
    this.page.set(0);
  }

  protected onKind(value: KindFilter): void {
    this.kind.set(value);
    this.page.set(0);
  }

  protected onPageSize(value: number): void {
    if (value !== 10 && value !== 20 && value !== 30) return;
    this.pageSize.set(value);
    this.page.set(0);
  }

  protected goPage(index: number): void {
    this.page.set(Math.max(0, Math.min(index, this.totalPages() - 1)));
  }

  protected async reload(): Promise<void> {
    this.generation++;
    this.videos.set([]);
    this.selected.set(new Set());
    this.nextPage.set(undefined);
    this.uploadsId = undefined;
    this.page.set(0);
    await this.fetchPage();
  }

  protected loadMore(): Promise<void> {
    return this.fetchPage();
  }

  protected async loadAll(): Promise<void> {
    const gen = this.generation;
    while (this.nextPage() && gen === this.generation && !this.error()) await this.fetchPage();
  }

  protected toggle(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected toggleAll(): void {
    const all = this.allSelected();
    this.selected.update((s) => {
      const next = new Set(s);
      for (const v of this.paged()) {
        if (all) next.delete(v.id);
        else next.add(v.id);
      }
      return next;
    });
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected afterBulk(updated: Video[]): void {
    const byId = new Map(updated.map((v) => [v.id, v]));
    this.videos.update((list) => list.map((v) => byId.get(v.id) ?? v));
    this.selected.set(new Set());
  }

  private async fetchPage(): Promise<void> {
    const gen = this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      if (!this.uploadsId) {
        this.uploadsId =
          this.channels.active()?.uploadsPlaylistId ??
          (await this.api.myChannel('contentDetails')).contentDetails?.relatedPlaylists.uploads;
      }
      if (!this.uploadsId) throw new Error('This channel has no uploads playlist.');
      const page = await this.api.uploadsPage(this.uploadsId, this.nextPage());
      const vids = await this.api.videos(page.items.map((i) => i.contentDetails.videoId));
      if (gen !== this.generation) return;
      this.videos.update((list) => [...list, ...vids]);
      this.nextPage.set(page.nextPageToken);
    } catch (e) {
      if (gen === this.generation) this.error.set(errorMessage(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }
}
