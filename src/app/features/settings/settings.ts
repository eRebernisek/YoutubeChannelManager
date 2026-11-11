import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, resource } from '@angular/core';
import { errorMessage } from '../../core/api-error';
import { ChannelsService } from '../../core/channels.service';
import { QUOTA_COSTS, QuotaMethod } from '../../core/quota-costs';
import { QuotaService } from '../../core/quota.service';
import { ChannelSettings, SettingsService, UploadDefaults } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { YoutubeApiService } from '../../core/youtube-api.service';
import { CategoriesService } from '../../shared/categories.service';

/** Per-channel defaults, schedule slots, quota cost overrides and settings export/import. */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="page-head">
        <h1>Settings</h1>
        <span class="muted small">for <strong>{{ channels.displayName(channels.active()) }}</strong></span>
      </div>

      @let s = draft();
      <div class="card stack">
        <h2>Upload defaults</h2>
        <div class="form-grid">
          <label class="field">
            Visibility
            <select [value]="s.upload.privacy" (change)="setUpload({ privacy: $any($event.target).value })">
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>
          <label class="field">
            Category
            <select (change)="setUpload({ categoryId: $any($event.target).value })">
              @for (c of categories.list.value() ?? []; track c.id) {
                <option [value]="c.id" [selected]="c.id === s.upload.categoryId">{{ c.snippet.title }}</option>
              } @empty {
                <option [value]="s.upload.categoryId">{{ s.upload.categoryId }}</option>
              }
            </select>
          </label>
          <label class="field">
            Language
            <input [value]="s.upload.language" (input)="setUpload({ language: $any($event.target).value })" />
          </label>
          <label class="field">
            License
            <select [value]="s.upload.license" (change)="setUpload({ license: $any($event.target).value })">
              <option value="youtube">Standard YouTube License</option>
              <option value="creativeCommon">Creative Commons</option>
            </select>
          </label>
          <label class="check">
            <input type="checkbox" [checked]="s.upload.madeForKids" (change)="setUpload({ madeForKids: $any($event.target).checked })" />
            Made for kids
          </label>
          <label class="check">
            <input type="checkbox" [checked]="s.upload.embeddable" (change)="setUpload({ embeddable: $any($event.target).checked })" />
            Allow embedding
          </label>
        </div>
        <strong class="small">Add every upload to these playlists</strong>
        @for (p of playlists.value() ?? []; track p.id) {
          <label class="check small">
            <input type="checkbox" [checked]="s.upload.playlistIds.includes(p.id)" (change)="togglePlaylist(p.id, $any($event.target).checked)" />
            {{ p.snippet.title }}
          </label>
        } @empty {
          <span class="muted small">{{ playlists.isLoading() ? 'Loading…' : 'No playlists.' }}</span>
        }
      </div>

      <div class="card stack">
        <h2>Schedule slots (São Paulo time)</h2>
        <p class="muted small">Used by "Use next schedule slot" and the batch scheduler.</p>
        <input
          [value]="s.scheduleSlots.join(', ')"
          placeholder="00:00, 12:00, 18:00"
          (change)="setSlots($any($event.target).value)"
        />
      </div>

      <div class="row">
        <button type="button" class="primary" [disabled]="!dirty()" (click)="save()">Save channel settings</button>
        <button type="button" [disabled]="!dirty()" (click)="draft.set(saved())">Discard</button>
      </div>

      <div class="card stack">
        <h2>Quota costs</h2>
        <p class="muted small">
          Estimated units per call, shared by all channels. Change a value if Google's
          <a href="https://developers.google.com/youtube/v3/determine_quota_cost" target="_blank" rel="noopener">quota table</a>
          changes. Empty = default.
        </p>
        <div class="costs">
          @for (m of methods; track m) {
            <label class="field">
              <span class="mono">{{ m }}</span>
              <input
                type="number"
                min="0"
                [placeholder]="defaults[m]"
                [value]="quota.overrides()[m] ?? ''"
                (change)="setCost(m, $any($event.target).value)"
              />
            </label>
          }
        </div>
      </div>

      <div class="card stack">
        <h2>Backup</h2>
        <p class="muted small">
          Settings live in this browser only. Export them (all channels; never includes sign-in tokens) to
          keep a copy or move to another browser.
        </p>
        <div class="row">
          <button type="button" (click)="exportAll()">Export settings</button>
          <label class="btn">
            Import settings
            <input type="file" accept="application/json,.json" hidden (change)="importAll($event)" />
          </label>
        </div>
      </div>
    </section>
  `,
  styles: `
    .costs {
      display: grid;
      gap: 0.5rem;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
    }
    input[hidden] {
      display: none;
    }
  `,
})
export class Settings {
  private readonly settings = inject(SettingsService);
  private readonly api = inject(YoutubeApiService);
  private readonly toast = inject(ToastService);
  protected readonly channels = inject(ChannelsService);
  protected readonly quota = inject(QuotaService);
  protected readonly categories = inject(CategoriesService);

  protected readonly methods = Object.keys(QUOTA_COSTS) as QuotaMethod[];
  protected readonly defaults = QUOTA_COSTS;

  protected readonly saved = computed(() => this.settings.current());
  /** Unsaved edits; resets when the active channel (and so `saved`) changes. */
  protected readonly draft = linkedSignal<ChannelSettings>(() => this.saved());
  protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));

  protected readonly playlists = resource({
    params: () => this.channels.activeId() ?? undefined,
    loader: () => this.api.myPlaylists(),
  });

  protected setUpload(change: Partial<UploadDefaults>): void {
    this.draft.update((s) => ({ ...s, upload: { ...s.upload, ...change } }));
  }

  protected togglePlaylist(id: string, on: boolean): void {
    const ids = this.draft().upload.playlistIds;
    this.setUpload({ playlistIds: on ? [...new Set([...ids, id])] : ids.filter((p) => p !== id) });
  }

  protected setSlots(text: string): void {
    const slots = text
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(t);
        return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
      });
    if (slots.some((s) => !s)) {
      this.toast.error('Use 24-hour times like 00:00, 12:00, 18:00.');
      return;
    }
    this.draft.update((s) => ({ ...s, scheduleSlots: [...new Set(slots as string[])].sort() }));
  }

  protected save(): void {
    const id = this.channels.activeId();
    if (!id) return;
    this.settings.save(id, this.draft());
    this.toast.ok('Saved.');
  }

  protected setCost(method: QuotaMethod, value: string): void {
    const next = { ...this.quota.overrides() };
    const n = Number(value);
    if (value === '' || !Number.isFinite(n) || n < 0) delete next[method];
    else next[method] = n;
    this.quota.setOverrides(next);
  }

  protected exportAll(): void {
    const blob = new Blob([this.settings.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `youtube-channel-manager-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  protected async importAll(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const n = this.settings.importAll(await file.text());
      this.toast.ok(`Imported ${n} settings. Reloading…`);
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
