import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-error';
import { validateThumbnail } from '../../core/media.util';
import { ToastService } from '../../core/toast.service';
import { APP_TZ, dateToZoned, zonedToDate } from '../../core/time.util';
import {
  moveChaptersToTop,
  parseTags,
  validateMetadata,
  videoKind,
  writableSnippet,
  writableStatus,
} from '../../core/video.util';
import { ChannelsService } from '../../core/channels.service';
import { VideoKindsService } from '../../core/video-kinds.service';
import { YoutubeApiService } from '../../core/youtube-api.service';
import { PrivacyStatus, Video } from '../../core/youtube.models';
import { CategoriesService } from '../../shared/categories.service';

type PrivacyChoice = PrivacyStatus | 'scheduled';

interface Form {
  title: string;
  description: string;
  tags: string;
  categoryId: string;
  privacy: PrivacyChoice;
  publishAt: string;
  madeForKids: boolean;
  license: 'youtube' | 'creativeCommon';
  embeddable: boolean;
  language: string;
  audioLanguage: string;
}

function toForm(v: Video): Form {
  const scheduled = v.status.privacyStatus === 'private' && !!v.status.publishAt;
  return {
    title: v.snippet.title,
    description: v.snippet.description ?? '',
    tags: (v.snippet.tags ?? []).join(', '),
    categoryId: v.snippet.categoryId,
    privacy: scheduled ? 'scheduled' : v.status.privacyStatus,
    publishAt: v.status.publishAt ? dateToZoned(new Date(v.status.publishAt)) : '',
    madeForKids: v.status.selfDeclaredMadeForKids ?? v.status.madeForKids ?? false,
    license: v.status.license ?? 'youtube',
    embeddable: v.status.embeddable ?? true,
    language: v.snippet.defaultLanguage ?? '',
    audioLanguage: v.snippet.defaultAudioLanguage ?? '',
  };
}

/** Edit one video. Reads the full resource and writes full parts back (spec §0.6). */
@Component({
  selector: 'app-video-edit',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="page-head">
        <a routerLink="/videos" class="btn sm ghost">← Videos</a>
        <h1 class="ellipsis" style="flex: 1">{{ form()?.title || 'Video' }}</h1>
        @if (video.value(); as v) {
          <a class="btn sm" [href]="'https://www.youtube.com/watch?v=' + v.id" target="_blank" rel="noopener">Watch</a>
          <a class="btn sm" [href]="'https://studio.youtube.com/video/' + v.id + '/edit'" target="_blank" rel="noopener">Studio</a>
        }
      </div>

      @if (video.error(); as err) {
        <p class="alert error">{{ message(err) }}</p>
      }

      @if (form(); as f) {
        <div class="layout">
          <div class="card stack">
            <label class="field">
              Title <span class="small">{{ f.title.length }}/100</span>
              <input [value]="f.title" (input)="patch({ title: $any($event.target).value })" />
            </label>
            <label class="field">
              Description <span class="small">{{ descBytes() }}/5000 bytes</span>
              <textarea rows="14" [value]="f.description" (input)="patch({ description: $any($event.target).value })"></textarea>
            </label>
            <div class="row">
              <button type="button" class="sm" (click)="chaptersToTop()">Move chapters to top of description</button>
            </div>
            <label class="field">
              Tags (comma-separated)
              <textarea rows="2" [value]="f.tags" (input)="patch({ tags: $any($event.target).value })"></textarea>
            </label>
          </div>

          <div class="stack">
            <div class="card stack">
              @if (video.value(); as v) {
                <img class="thumb big" [src]="v.snippet.thumbnails?.medium?.url" alt="Current thumbnail" referrerpolicy="no-referrer" />
                <span class="row small">
                  <span class="badge">{{ kind() }}</span>
                  <span class="muted">{{ v.statistics?.viewCount ?? 0 }} views</span>
                </span>
              }
              <label class="field">
                Replace thumbnail (JPG/PNG, ≤ 2 MB, 1280×720)
                <input type="file" accept="image/jpeg,image/png" (change)="setThumbnail($event)" [disabled]="saving()" />
              </label>
            </div>

            <div class="card stack">
              <label class="field">
                Visibility
                <select [value]="f.privacy" (change)="patch({ privacy: $any($event.target).value })">
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              </label>
              @if (f.privacy === 'scheduled') {
                <label class="field">
                  Publish at ({{ tz }})
                  <input type="datetime-local" [value]="f.publishAt" (input)="patch({ publishAt: $any($event.target).value })" />
                </label>
                <span class="muted small">Only works on videos that were never public.</span>
              }
              <label class="field">
                Category
                <select (change)="patch({ categoryId: $any($event.target).value })">
                  @for (c of categories.list.value() ?? []; track c.id) {
                    <option [value]="c.id" [selected]="c.id === f.categoryId">{{ c.snippet.title }}</option>
                  } @empty {
                    <option [value]="f.categoryId">{{ f.categoryId }}</option>
                  }
                </select>
              </label>
              <div class="form-grid">
                <label class="field">
                  Title/description language
                  <input [value]="f.language" placeholder="en" (input)="patch({ language: $any($event.target).value })" />
                </label>
                <label class="field">
                  Audio language
                  <input [value]="f.audioLanguage" placeholder="en" (input)="patch({ audioLanguage: $any($event.target).value })" />
                </label>
              </div>
              <label class="field">
                License
                <select [value]="f.license" (change)="patch({ license: $any($event.target).value })">
                  <option value="youtube">Standard YouTube License</option>
                  <option value="creativeCommon">Creative Commons</option>
                </select>
              </label>
              <label class="check">
                <input type="checkbox" [checked]="f.madeForKids" (change)="patch({ madeForKids: $any($event.target).checked })" />
                Made for kids
              </label>
              <label class="check">
                <input type="checkbox" [checked]="f.embeddable" (change)="patch({ embeddable: $any($event.target).checked })" />
                Allow embedding
              </label>
            </div>
          </div>
        </div>

        @for (e of errors(); track e) {
          <p class="alert error small">{{ e }}</p>
        }

        <div class="row actions">
          <button type="button" class="primary" [disabled]="!dirty() || saving() || errors().length > 0" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
          <button type="button" [disabled]="!dirty() || saving()" (click)="reset()">Discard</button>
          <span class="muted small">~{{ saveCost }} quota units per save</span>
          <span class="spacer"></span>
          <button type="button" class="danger" [disabled]="saving()" (click)="remove()">Delete video</button>
        </div>
      } @else if (video.isLoading()) {
        <div class="spinner"></div>
      }
    </section>
  `,
  styles: `
    .layout {
      display: grid;
      gap: 1rem;
      grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
      @media (max-width: 800px) {
        grid-template-columns: 1fr;
      }
    }
    .thumb.big {
      width: 100%;
    }
    .actions {
      position: sticky;
      bottom: 0;
      padding: 0.75rem 0;
      background: var(--bg);
    }
  `,
})
export class VideoEdit {
  private readonly api = inject(YoutubeApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly categories = inject(CategoriesService);
  private readonly kindsSvc = inject(VideoKindsService);

  constructor() {
    const channelId = inject(ChannelsService).activeId();
    // Only the type badge depends on this; a failure just leaves it as Video.
    if (channelId) this.kindsSvc.load(channelId).catch(() => undefined);
  }

  /** Route param. */
  readonly id = input.required<string>();

  protected readonly tz = APP_TZ;
  protected readonly saveCost = 50;
  protected readonly saving = signal(false);
  private readonly edits = signal<Form | null>(null);

  protected readonly video = resource({
    params: () => this.id(),
    loader: ({ params: id }) => this.api.video(id),
  });

  private readonly original = computed(() => {
    const v = this.video.value();
    return v ? toForm(v) : null;
  });
  protected readonly form = computed(() => this.edits() ?? this.original());
  protected readonly dirty = computed(
    () => !!this.edits() && JSON.stringify(this.edits()) !== JSON.stringify(this.original()),
  );
  protected readonly kind = computed(() => {
    const v = this.video.value();
    return v ? videoKind(v, this.kindsSvc.kinds()) : '';
  });
  protected readonly descBytes = computed(
    () => new TextEncoder().encode(this.form()?.description ?? '').length,
  );
  protected readonly errors = computed(() => {
    const f = this.form();
    if (!f) return [];
    const errs = validateMetadata({ title: f.title, description: f.description, tags: parseTags(f.tags) });
    if (f.privacy === 'scheduled') {
      const at = zonedToDate(f.publishAt);
      if (!at) errs.push('Pick a publish date and time.');
      else if (this.dirty() && at.getTime() <= Date.now()) errs.push('Publish time must be in the future.');
    }
    return errs;
  });

  protected patch(change: Partial<Form>): void {
    const f = this.form();
    if (f) this.edits.set({ ...f, ...change });
  }

  protected reset(): void {
    this.edits.set(null);
  }

  protected chaptersToTop(): void {
    const f = this.form();
    if (!f) return;
    const moved = moveChaptersToTop(f.description);
    if (moved === f.description) this.toast.show('No chapter list found (needs 3+ timestamp lines).');
    else this.patch({ description: moved });
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.saving.set(true);
    try {
      // Read the latest version, then overwrite only the fields this form edits.
      const current = await this.api.video(this.id(), 'snippet,status');
      const snippet = writableSnippet({
        ...current.snippet,
        title: f.title.trim(),
        description: f.description,
        tags: parseTags(f.tags),
        categoryId: f.categoryId,
        defaultLanguage: f.language.trim() || undefined,
        defaultAudioLanguage: f.audioLanguage.trim() || undefined,
      });
      const scheduled = f.privacy === 'scheduled';
      const status = writableStatus({
        ...current.status,
        privacyStatus: f.privacy === 'scheduled' ? 'private' : f.privacy,
        publishAt: scheduled ? zonedToDate(f.publishAt)!.toISOString() : undefined,
        selfDeclaredMadeForKids: f.madeForKids,
        madeForKids: undefined,
        license: f.license,
        embeddable: f.embeddable,
      });
      await this.api.updateVideo({ id: this.id(), snippet, status }, ['snippet', 'status']);
      this.edits.set(null);
      this.video.reload();
      this.toast.ok('Saved.');
    } catch (e) {
      // Keep the edits so nothing is lost; the user can sign in again and retry.
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected async setThumbnail(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    const { errors, warnings } = await validateThumbnail(file);
    if (errors.length) {
      this.toast.error(errors.join(' '));
      return;
    }
    if (warnings.length && !confirm(warnings.join('\n') + '\n\nUpload anyway?')) return;
    this.saving.set(true);
    try {
      await this.api.setThumbnail(this.id(), file);
      this.toast.ok('Thumbnail updated. YouTube may take a minute to show it.');
      this.video.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const v = this.video.value();
    if (!v) return;
    const typed = prompt(
      `This permanently deletes "${v.snippet.title}" from YouTube. It can't be undone.\n\nType DELETE to confirm.`,
    );
    if (typed !== 'DELETE') return;
    this.saving.set(true);
    try {
      await this.api.deleteVideo(v.id);
      this.toast.ok('Video deleted.');
      void this.router.navigateByUrl('/videos');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected message(e: unknown): string {
    return errorMessage(e);
  }
}
