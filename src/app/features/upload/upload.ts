import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { errorMessage } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { ChannelsService } from '../../core/channels.service';
import { formatBytes, isVideoFile, validateThumbnail } from '../../core/media.util';
import { QuotaService } from '../../core/quota.service';
import { ResumableUpload } from '../../core/resumable-upload';
import { SettingsService } from '../../core/settings.service';
import { nextFreeSlots } from '../../core/slots';
import { APP_TZ, dateToZoned, formatSaoPaulo, zonedToDate } from '../../core/time.util';
import { ToastService } from '../../core/toast.service';
import { moveChaptersToTop, parseTags, validateMetadata } from '../../core/video.util';
import { YoutubeApiService } from '../../core/youtube-api.service';
import { Video } from '../../core/youtube.models';
import { PrivacyChoice, VideoMetadata, parseMetadata } from '../../metadata/md-parser';
import { CategoriesService } from '../../shared/categories.service';

interface UploadForm {
  title: string;
  description: string;
  tags: string;
  categoryId: string;
  privacy: PrivacyChoice;
  publishAt: string;
  madeForKids: boolean;
  language: string;
  license: 'youtube' | 'creativeCommon';
  embeddable: boolean;
  playlistIds: string[];
  pinnedComment: string;
}

interface Step {
  label: string;
  status: 'pending' | 'running' | 'ok' | 'error' | 'skipped';
  detail?: string;
}

type Phase = 'edit' | 'uploading' | 'finishing' | 'done';

const TEMPLATE_URL =
  'https://github.com/erebernisek/YoutubeChannelManager/blob/main/docs/metadata-template.md';

/** Upload one video with a thumbnail and a `.md` metadata file; publish now or schedule (spec §3). */
@Component({
  selector: 'app-upload',
  imports: [DecimalPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './upload.html',
  styleUrl: './upload.scss',
})
export class Upload implements OnDestroy {
  private readonly api = inject(YoutubeApiService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  protected readonly channels = inject(ChannelsService);
  protected readonly quota = inject(QuotaService);
  protected readonly categories = inject(CategoriesService);

  protected readonly tz = APP_TZ;
  protected readonly templateUrl = TEMPLATE_URL;
  protected readonly auditApproved = environment.apiAuditApproved;
  protected readonly formatBytes = formatBytes;

  protected readonly videoFile = signal<File | null>(null);
  protected readonly thumbFile = signal<File | null>(null);
  protected readonly thumbPreview = signal<string | null>(null);
  protected readonly thumbCheck = signal<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  protected readonly mdFile = signal<File | null>(null);
  protected readonly meta = signal<VideoMetadata | null>(null);
  protected readonly notes = signal<string[]>([]);
  protected readonly form = signal<UploadForm>(this.defaults());
  protected readonly channelConfirmed = signal(false);
  protected readonly dragging = signal(false);

  protected readonly phase = signal<Phase>('edit');
  protected readonly upload = signal<ResumableUpload | null>(null);
  protected readonly steps = signal<Step[]>([]);
  protected readonly result = signal<Video | null>(null);
  private unlock?: () => void;

  protected readonly playlists = resource({
    params: () => this.channels.activeId() ?? undefined,
    loader: () => this.api.myPlaylists(),
  });

  /** The `.md` names a channel that isn't the active one. */
  protected readonly channelMismatch = computed(() => {
    const ref = this.meta()?.channel;
    const active = this.channels.active();
    if (!ref || !active) return null;
    const match = this.channels.match(ref);
    return match?.id === active.id ? null : { ref, known: match ?? null };
  });

  protected readonly errors = computed(() => {
    const f = this.form();
    const errs = validateMetadata({ title: f.title, description: f.description, tags: parseTags(f.tags) });
    if (!this.videoFile()) errs.unshift('Pick a video file.');
    errs.push(...this.thumbCheck().errors);
    if (f.privacy === 'scheduled') {
      const at = zonedToDate(f.publishAt);
      if (!at) errs.push('Pick a publish date and time.');
      else if (at.getTime() <= Date.now() + 60_000) errs.push('Publish time must be in the future.');
    }
    if (this.channelMismatch() && !this.channelConfirmed()) {
      errs.push('Confirm the channel (see the warning above) or switch channels.');
    }
    return errs;
  });

  protected readonly estimatedCost = computed(() => {
    const f = this.form();
    return (
      this.quota.cost('videos.insert') +
      (this.thumbFile() ? this.quota.cost('thumbnails.set') : 0) +
      f.playlistIds.length * this.quota.cost('playlistItems.insert') +
      (f.pinnedComment.trim() ? this.quota.cost('commentThreads.insert') : 0)
    );
  });

  protected readonly publishLabel = computed(() => {
    const f = this.form();
    if (f.privacy !== 'scheduled') return f.privacy;
    const at = zonedToDate(f.publishAt);
    return at ? `scheduled for ${formatSaoPaulo(at)} (São Paulo)` : 'scheduled';
  });

  protected readonly percent = computed(() => {
    const u = this.upload();
    return u && u.total ? (u.sent() / u.total) * 100 : 0;
  });

  ngOnDestroy(): void {
    this.upload()?.cancel();
    this.unlock?.();
    const url = this.thumbPreview();
    if (url) URL.revokeObjectURL(url);
  }

  // ---- files ------------------------------------------------------------------------------------

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.addFiles([...(input.files ?? [])]);
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.addFiles([...(event.dataTransfer?.files ?? [])]);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  private async addFiles(files: File[]): Promise<void> {
    if (this.phase() !== 'edit') return;
    const md = files.find((f) => /\.(md|markdown|txt)$/i.test(f.name));
    const video = files.find(isVideoFile);
    const images = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
    const unknown = files.filter((f) => f !== md && f !== video && !images.includes(f));
    if (unknown.length) this.toast.show(`Ignored: ${unknown.map((f) => f.name).join(', ')}`);

    if (video) this.videoFile.set(video);
    let meta = this.meta();
    if (md) {
      meta = parseMetadata(await md.text());
      this.mdFile.set(md);
      this.meta.set(meta);
      this.channelConfirmed.set(false);
      this.applyMeta(meta);
    }
    // Prefer the image the .md names; otherwise take the only image picked.
    const named = meta?.thumbnail
      ? images.find((f) => f.name.toLowerCase() === meta.thumbnail!.toLowerCase())
      : undefined;
    const image = named ?? (images.length === 1 ? images[0] : undefined);
    if (image) await this.setThumb(image);
    else if (images.length > 1) this.toast.show('Several images picked; drop just the thumbnail.');
    this.refreshNotes();
  }

  protected async setThumb(file: File | null): Promise<void> {
    const old = this.thumbPreview();
    if (old) URL.revokeObjectURL(old);
    this.thumbFile.set(file);
    this.thumbPreview.set(file ? URL.createObjectURL(file) : null);
    this.thumbCheck.set(file ? await validateThumbnail(file) : { errors: [], warnings: [] });
    this.refreshNotes();
  }

  protected clearVideo(): void {
    this.videoFile.set(null);
  }

  protected clearMd(): void {
    this.mdFile.set(null);
    this.meta.set(null);
    this.form.set(this.defaults());
    this.refreshNotes();
  }

  // ---- form -------------------------------------------------------------------------------------

  protected patch(change: Partial<UploadForm>): void {
    this.form.update((f) => ({ ...f, ...change }));
  }

  protected togglePlaylist(id: string, on: boolean): void {
    this.form.update((f) => ({
      ...f,
      playlistIds: on ? [...new Set([...f.playlistIds, id])] : f.playlistIds.filter((p) => p !== id),
    }));
  }

  protected chaptersToTop(): void {
    const d = this.form().description;
    const moved = moveChaptersToTop(d);
    if (moved === d) this.toast.show('No chapter list found (needs 3+ timestamp lines).');
    else this.patch({ description: moved });
  }

  protected useNextSlot(): void {
    const [slot] = nextFreeSlots(this.settings.current().scheduleSlots, 1);
    if (slot) this.patch({ privacy: 'scheduled', publishAt: dateToZoned(slot) });
    else this.toast.show('No schedule slots set. Add some in Settings.');
  }

  protected switchToMdChannel(): void {
    const known = this.channelMismatch()?.known;
    if (known) void this.auth.switchTo(known.id);
  }

  private defaults(): UploadForm {
    const d = this.settings.current().upload;
    return {
      title: '',
      description: '',
      tags: '',
      categoryId: d.categoryId,
      privacy: d.privacy,
      publishAt: '',
      madeForKids: d.madeForKids,
      language: d.language,
      license: d.license,
      embeddable: d.embeddable,
      playlistIds: [...d.playlistIds],
      pinnedComment: '',
    };
  }

  private applyMeta(m: VideoMetadata): void {
    const base = this.defaults();
    const publishAt = m.publishAt ? zonedToDate(m.publishAt) : null;
    this.form.set({
      ...base,
      title: m.title ?? base.title,
      description: m.description ?? base.description,
      tags: m.tags?.join(', ') ?? base.tags,
      categoryId: m.categoryId ?? base.categoryId,
      privacy: m.privacy ?? base.privacy,
      publishAt: publishAt ? dateToZoned(publishAt) : '',
      madeForKids: m.madeForKids ?? base.madeForKids,
      language: m.language ?? base.language,
      playlistIds: [...new Set([...base.playlistIds, ...this.playlistIdsByName(m.playlists ?? [])])],
      pinnedComment: m.pinnedComment ?? '',
    });
  }

  private playlistIdsByName(names: string[]): string[] {
    const list = this.playlists.value() ?? [];
    return names
      .map((n) => list.find((p) => p.snippet.title.toLowerCase() === n.toLowerCase())?.id)
      .filter((id): id is string => !!id);
  }

  /** Non-blocking notes about the picked files and the .md. */
  private refreshNotes(): void {
    const notes = [...(this.meta()?.warnings ?? [])];
    const m = this.meta();
    if (m) {
      if (!m.title) notes.push('The .md has no title.');
      if (m.description === undefined) notes.push('The .md has no description.');
      const list = this.playlists.value();
      for (const name of m.playlists ?? []) {
        if (list && !list.some((p) => p.snippet.title.toLowerCase() === name.toLowerCase())) {
          notes.push(`Playlist "${name}" wasn't found on this channel.`);
        }
      }
      if (m.thumbnail && this.thumbFile()?.name.toLowerCase() !== m.thumbnail.toLowerCase()) {
        notes.push(`The .md names thumbnail "${m.thumbnail}". Pick that file too.`);
      }
    }
    notes.push(...this.thumbCheck().warnings);
    this.notes.set(notes);
  }

  // ---- upload -----------------------------------------------------------------------------------

  protected start(): void {
    const file = this.videoFile();
    if (!file || this.errors().length) return;
    if (!this.quota.fits(this.estimatedCost())) {
      if (!confirm("This may go over today's estimated API quota. Upload anyway?")) return;
    }
    const f = this.form();
    const scheduled = f.privacy === 'scheduled';
    const upload = new ResumableUpload(
      file,
      {
        snippet: {
          title: f.title.trim(),
          description: f.description,
          tags: parseTags(f.tags),
          categoryId: f.categoryId,
          defaultLanguage: f.language || undefined,
          defaultAudioLanguage: f.language || undefined,
        },
        status: {
          privacyStatus: f.privacy === 'scheduled' ? 'private' : f.privacy,
          publishAt: scheduled ? zonedToDate(f.publishAt)!.toISOString() : undefined,
          selfDeclaredMadeForKids: f.madeForKids,
          license: f.license,
          embeddable: f.embeddable,
        },
      },
      {
        token: () => this.auth.accessToken(),
        tokenRejected: () => this.auth.tokenRejected(),
        onStarted: () => this.quota.record('videos.insert'),
      },
    );
    this.unlock = this.auth.lock('An upload');
    this.upload.set(upload);
    this.phase.set('uploading');
    upload.start().then(
      (video) => void this.finish(video),
      () => {
        // Cancelled or failed for good: back to editing with the form intact.
        this.unlock?.();
        this.phase.set('edit');
      },
    );
  }

  protected cancel(): void {
    if (confirm('Cancel this upload?')) this.upload()?.cancel();
  }

  private async finish(video: Video): Promise<void> {
    this.phase.set('finishing');
    const f = this.form();
    const steps: Step[] = [{ label: 'Upload video', status: 'ok', detail: video.id }];
    const thumb = this.thumbFile();
    steps.push({ label: 'Set thumbnail', status: thumb ? 'pending' : 'skipped' });
    for (const id of f.playlistIds) {
      const name = this.playlists.value()?.find((p) => p.id === id)?.snippet.title ?? id;
      steps.push({ label: `Add to playlist "${name}"`, status: 'pending' });
    }
    const comment = f.pinnedComment.trim();
    steps.push({ label: 'Post comment (pin it in Studio)', status: comment ? 'pending' : 'skipped' });
    this.steps.set(steps);

    const run = async (index: number, action: () => Promise<unknown>) => {
      this.setStep(index, { status: 'running' });
      try {
        await action();
        this.setStep(index, { status: 'ok' });
      } catch (e) {
        this.setStep(index, { status: 'error', detail: errorMessage(e) });
      }
    };
    let i = 1;
    if (thumb) await run(i, () => this.api.setThumbnail(video.id, thumb));
    i++;
    for (const id of f.playlistIds) await run(i++, () => this.api.addToPlaylist(id, video.id));
    if (comment) await run(i, () => this.api.postComment(video.id, comment));

    this.result.set(video);
    this.phase.set('done');
    this.unlock?.();
    this.toast.ok('Upload finished.');
  }

  private setStep(index: number, change: Partial<Step>): void {
    this.steps.update((s) => s.map((step, i) => (i === index ? { ...step, ...change } : step)));
  }

  protected reset(): void {
    this.upload.set(null);
    this.steps.set([]);
    this.result.set(null);
    this.videoFile.set(null);
    void this.setThumb(null);
    this.clearMd();
    this.phase.set('edit');
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.phase() === 'uploading' || this.phase() === 'finishing') event.preventDefault();
  }
}
