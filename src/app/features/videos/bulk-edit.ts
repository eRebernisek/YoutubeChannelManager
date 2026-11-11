import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { errorMessage } from '../../core/api-error';
import { QuotaService } from '../../core/quota.service';
import { parseTags, validateMetadata } from '../../core/video.util';
import { YoutubeApiService } from '../../core/youtube-api.service';
import { Video } from '../../core/youtube.models';
import { BulkChange, BulkOps, EMPTY_OPS, computeBulkChange } from './bulk';

/** Bulk edit for the selected videos: preview every change and its quota cost before saving. */
@Component({
  selector: 'app-bulk-edit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack">
      <div class="row">
        <h2>Bulk edit {{ videos().length }} videos</h2>
        <span class="spacer"></span>
        <button type="button" class="sm ghost" (click)="cancel.emit()" [disabled]="running()">Clear selection</button>
      </div>
      <div class="form-grid">
        <label class="field">
          Find (description)
          <input [value]="ops().find" (input)="set('find', $any($event.target).value)" />
        </label>
        <label class="field">
          Replace with
          <input [value]="ops().replace" (input)="set('replace', $any($event.target).value)" />
        </label>
        <label class="check small" style="align-self: end">
          <input type="checkbox" [checked]="ops().replaceInTitle" (change)="set('replaceInTitle', $any($event.target).checked)" />
          Also replace in titles
        </label>
        <label class="field wide">
          Add text at the top of descriptions
          <textarea rows="2" [value]="ops().prependDescription" (input)="set('prependDescription', $any($event.target).value)"></textarea>
        </label>
        <label class="field wide">
          Add text at the bottom of descriptions
          <textarea rows="2" [value]="ops().appendDescription" (input)="set('appendDescription', $any($event.target).value)"></textarea>
        </label>
        <label class="field">
          Add tags (comma-separated)
          <input (input)="set('addTags', parse($any($event.target).value))" />
        </label>
        <label class="field">
          Remove tags (comma-separated)
          <input (input)="set('removeTags', parse($any($event.target).value))" />
        </label>
        <label class="field">
          Privacy
          <select [value]="ops().privacy" (change)="set('privacy', $any($event.target).value)">
            <option value="">No change</option>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </label>
      </div>

      @if (changes().length) {
        <div class="stack small preview">
          <strong>Preview: {{ changes().length }} videos change · ~{{ cost() }} quota units</strong>
          @for (c of changes(); track c.video.id) {
            <div>
              <span class="ellipsis">{{ c.video.snippet.title }}</span>
              <span class="muted"> — {{ c.summary.join(', ') }}</span>
              @if (problems().get(c.video.id); as errs) {
                <span class="badge danger">{{ errs.join(' ') }}</span>
              }
            </div>
          }
        </div>
        @if (!quota.fits(cost())) {
          <p class="alert warn small">This would go over today's estimated quota.</p>
        }
        @if (progress(); as p) {
          <div class="progress"><span [style.width.%]="(p.done / p.total) * 100"></span></div>
          <span class="small muted">{{ p.done }} / {{ p.total }}</span>
        }
        @if (error(); as err) {
          <p class="alert error small">{{ err }}</p>
        }
        <div class="row">
          <button type="button" class="primary" [disabled]="running() || problems().size > 0" (click)="apply()">
            Save {{ changes().length }} videos
          </button>
        </div>
      } @else {
        <p class="muted small">Set an action above to see what would change.</p>
      }
    </div>
  `,
  styles: `
    .preview {
      max-height: 260px;
      overflow: auto;
      padding: 0.5rem;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
  `,
})
export class BulkEdit {
  private readonly api = inject(YoutubeApiService);
  protected readonly quota = inject(QuotaService);

  readonly videos = input.required<Video[]>();
  readonly done = output<Video[]>();
  readonly cancel = output<void>();

  protected readonly ops = signal<BulkOps>(EMPTY_OPS);
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly progress = signal<{ done: number; total: number } | null>(null);

  protected readonly changes = computed(() =>
    this.videos()
      .map((v) => computeBulkChange(v, this.ops()))
      .filter((c) => c.snippet || c.status),
  );
  protected readonly cost = computed(
    () => this.changes().length * this.quota.cost('videos.update') + Math.ceil(this.changes().length / 50),
  );
  protected readonly problems = computed(() => {
    const map = new Map<string, string[]>();
    for (const c of this.changes()) {
      if (!c.snippet) continue;
      const errs = validateMetadata({ ...c.snippet, tags: c.snippet.tags ?? [] });
      if (errs.length) map.set(c.video.id, errs);
    }
    return map;
  });

  protected set<K extends keyof BulkOps>(key: K, value: BulkOps[K]): void {
    this.ops.update((o) => ({ ...o, [key]: value }));
  }

  protected parse(text: string): string[] {
    return parseTags(text);
  }

  protected async apply(): Promise<void> {
    const ids = this.changes().map((c) => c.video.id);
    if (!confirm(`Update ${ids.length} videos on YouTube?`)) return;
    this.running.set(true);
    this.error.set(null);
    const updated: Video[] = [];
    try {
      // Re-read right before writing so edits made elsewhere since loading aren't overwritten.
      const fresh = await this.api.videos(ids);
      const todo = fresh.map((v) => computeBulkChange(v, this.ops())).filter((c) => c.snippet || c.status);
      this.progress.set({ done: 0, total: todo.length });
      for (const c of todo) {
        updated.push(await this.save(c));
        this.progress.update((p) => p && { ...p, done: p.done + 1 });
      }
      this.ops.set(EMPTY_OPS);
    } catch (e) {
      this.error.set(`Stopped after ${updated.length} videos: ${errorMessage(e)}`);
    } finally {
      this.running.set(false);
      if (updated.length) this.done.emit(updated);
    }
  }

  private async save(c: BulkChange): Promise<Video> {
    const parts: ('snippet' | 'status')[] = [];
    if (c.snippet) parts.push('snippet');
    if (c.status) parts.push('status');
    const res = await this.api.updateVideo({ id: c.video.id, snippet: c.snippet, status: c.status }, parts);
    return {
      ...c.video,
      snippet: { ...c.video.snippet, ...(res.snippet ?? c.snippet) },
      status: res.status ?? c.status ?? c.video.status,
    };
  }
}
